/**
 * A bunch of utility functions common to multiple scripts
 */

const path = require('path');
const URL = require('url');
const fetch = require('./fetch');
const { JSDOM } = require('./jsdom-monkeypatch');



/**
 * Wrapper around the "require" function to require files relative to the
 * current working directory (CWD), instead of relative to the current JS
 * file.
 *
 * This is typically needed to be able to use "require" to load JSON config
 * files provided as command-line arguments.
 *
 * @function
 * @param {String} filename The path to the file to require
 * @return {Object} The result of requiring the file relative to the current
 *   working directory.
 */
function requireFromWorkingDirectory(filename) {
    return require(path.resolve(filename));
}


/**
 * Load the given HTML.
 *
 * @function
 * @public
 * @param {Object} spec The spec to load. Must contain an "html" property with
 *   the HTML contents to load. May also contain an "url" property with the URL
 *   of the document (defaults to "about:blank"), and a "responseUrl" property
 *   with the final URL of the document (which may differ from the initial URL
 *   in case there were redirects and which defaults to the value of the "url"
 *   property)
 * @param {Number} counter Optional loop counter parameter to detect infinite
 *   loop. The parameter is mostly meant to be an internal parameter, set and
 *   incremented between calls when dealing with redirections. There should be
 *   no need to set that parameter when calling that function externally.
 * @return {Promise} The promise to get a window object once the spec has
 *   been loaded with jsdom.
 */
async function loadSpecificationFromHtml(spec, counter) {
    let url = spec.url || 'about:blank';
    let responseUrl = spec.responseUrl || url;
    let html = spec.html || '';
    counter = counter || 0;

    let promise = new Promise((resolve, reject) => {
        // Drop Byte-Order-Mark character if needed, it bugs JSDOM
        if (html.charCodeAt(0) === 0xFEFF) {
            html = html.substring(1);
        }
        const {window} = new JSDOM(html, {
            url: responseUrl,
            resources: 'usable',
            runScripts: 'dangerously',
            beforeParse(window) {
                // Wait until the generation of Respec documents is over
                window.addEventListener('load', function () {
                    let usesRespec = window.respecConfig &&
                        window.document.head.querySelector("script[src*='respec']");
                    let resolveWhenReady = _ => {
                        if (window.document.respecIsReady) {
                            window.document.respecIsReady
                                .then(_=> resolve(window))
                                .catch(reject);
                        }
                        else if (usesRespec) {
                            setTimeout(resolveWhenReady, 100);
                        }
                        else {
                            resolve(window);
                        }
                    }
                    resolveWhenReady();
                });
            }
        });
    });

    return promise.then(window => {
        let doc = window.document;

        // Handle <meta http-equiv="refresh"> redirection
        // Note that we'll assume that the number in "content" is correct
        let metaRefresh = doc.querySelector('meta[http-equiv="refresh"]');
        if (metaRefresh) {
            let redirectUrl = (metaRefresh.getAttribute('content') || '').split(';')[1];
            if (redirectUrl) {
                redirectUrl = URL.resolve(doc.baseURI, redirectUrl.trim());
                if ((redirectUrl !== url) && (redirectUrl !== responseUrl)) {
                    return loadSpecificationFromUrl(redirectUrl, counter + 1);
                }
            }
        }

        const links = doc.querySelectorAll('body .head dl a[href]');
        for (let i = 0 ; i < links.length; i++) {
            let link = links[i];
            let text = (link.textContent || '').toLowerCase();
            if (text.includes('single page') ||
                text.includes('single file') ||
                text.includes('single-page') ||
                text.includes('one-page')) {
                let singlePage = URL.resolve(doc.baseURI, link.getAttribute('href'));
                if ((singlePage === url) || (singlePage === responseUrl)) {
                    // We're already looking at the single page version
                    return window;
                }
                else {
                    return loadSpecificationFromUrl(singlePage, counter + 1);
                }
                return;
            }
        }
        return window;
    });
}


/**
 * Load the specification at the given URL.
 *
 * @function
 * @public
 * @param {String} url The URL of the specification to load
 * @param {Number} counter Optional loop counter parameter to detect infinite
 *   loop. The parameter is mostly meant to be an internal parameter, set and
 *   incremented between calls when dealing with redirections. There should be
 *   no need to set that parameter when calling that function externally.
 * @return {Promise} The promise to get a window object once the spec has
 *   been loaded with jsdom.
 */
function loadSpecificationFromUrl(url, counter) {
    counter = counter || 0;
    if (counter >= 5) {
        return new Promise((resolve, reject) => {
            reject(new Error('Infinite loop detected'));
        });
    }
    return fetch(url)
        .then(response => response.text().then(html => {
            return { url, html, responseUrl: response.url };
        }))
        .then(spec => loadSpecificationFromHtml(spec, counter));
}


/**
 * Load the given specification.
 *
 * @function
 * @public
 * @param {String|Object} spec The URL of the specification to load or an object
 *   with an "html" key that contains the HTML to load (and an optional "url"
 *   key to force the URL in the loaded DOM)
 * @return {Promise} The promise to get a window object once the spec has
 *   been loaded with jsdom.
 */
function loadSpecification(spec) {
    spec = (typeof spec === 'string') ? { url: spec } : spec;
    return (spec.html ?
        loadSpecificationFromHtml(spec) :
        loadSpecificationFromUrl(spec.url));
}

function urlOrDom(input) {
    if (typeof input === "string") {
        return loadSpecification(input);
    } else {
        return Promise.resolve(input);
    }
}

/**
 * Given a "window" object loaded with jsdom, retrieve the document along
 * with the name of the well-known generator that was used, if known.
 *
 * Note that the function only returns when the document is properly generated
 * (typically, once ReSpec is done generating the document if the spec being
 * considered is a raw ReSpec document)
 *
 * @function
 * @public
 * @param {Window} window
 * @return {Promise} The promise to get a document ready for extraction and
 *   the name of the generator (or null if generator is unknown).
 */
function getDocumentAndGenerator(window) {
    return new Promise(function (resolve, reject) {
        var doc = window.document;
        var generator = window.document.querySelector("meta[name='generator']");
        var timeout = null;
        if (generator && generator.content.match(/bikeshed/i)) {
            resolve({doc, generator:'bikeshed'});
        } else if (doc.body.id === "respecDocument") {
            resolve({doc, generator:'respec'});
        } else if (window.respecConfig &&
            window.document.head.querySelector("script[src*='respec']")) {
            if (!window.respecConfig.postProcess) {
                window.respecConfig.postProcess = [];
            }
            window.respecConfig.postProcess.push(function() {
                if (timeout) {
                    clearTimeout(timeout);
                }
                resolve({doc, generator: 'respec'});
            });
            timeout = setTimeout(function () {
              reject(new Error('Specification apparently uses ReSpec but document generation timed out'));
            }, 30000);
        } else if (doc.getElementById('anolis-references')) {
            resolve({doc, generator: 'anolis'});
        } else {
            resolve({doc});
        }
    });
}

module.exports.fetch = fetch;
module.exports.requireFromWorkingDirectory = requireFromWorkingDirectory;
module.exports.loadSpecification = loadSpecification;
module.exports.urlOrDom = urlOrDom;
module.exports.getDocumentAndGenerator = getDocumentAndGenerator;