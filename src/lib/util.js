/**
 * A bunch of utility functions common to multiple scripts
 */

const fs = require('fs').promises;
const { existsSync } = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const { AbortController } = require('abortcontroller-polyfill/dist/cjs-ponyfill');
const fetch = require('./fetch');
const specEquivalents = require('../specs/spec-equivalents.json');


/**
 * Shortcut that returns a property extractor iterator
 */
const prop = p => x => x[p];


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
 * Determine the path to the "node_modules" folder to resolve relative links
 * in the ES6 browser lib modules. The path depends on whether Reffy is run
 * directly, or installed as a library.
 *
 * @function
 * @return {String} Path to the node_modules folder.
 */
function getModulesFolder() {
    const rootFolder = path.resolve(__dirname, '../..');
    let folder = path.resolve(rootFolder, 'node_modules');
    if (existsSync(folder)) {
        return folder;
    }
    folder = path.resolve(rootFolder, '..');
    return folder;
}
const modulesFolder = getModulesFolder();


/**
 * Puppeteer browser instance used to load and process specifications
 */
let browser = null;


/**
 * Setup and launch browser instance to use to load and process specifications.
 *
 * The function must be called before any attempt to call `processSpecification`
 * and should only be called once.
 *
 * The function also generates the code that will inject the `reffy` namespace
 * in each processed page.
 *
 * Note: Switch `headless` to `false` to access dev tools and debug processing
 *
 * @function
 * @public
 */
async function setupBrowser() {
    // Create browser instance (one per specification. Switch "headless" to
    // "false" (and commenting out the call to "browser.close()") is typically
    // useful when something goes wrong to access dev tools and debug)
    browser = await puppeteer.launch({ headless: true });
}


/**
 * Close and destroy browser instance.
 *
 * The function should be called once at the end of the processing.
 *
 * @function
 * @public
 */
async function teardownBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
    }
}


/**
 * Load and process the given specification.
 *
 * The method automatically exposes Reffy's library functions in a window.reffy
 * namespace (see src/browserlib/reffy.mjs) so that the callback function can
 * call them directly. Additional callback arguments that would need to be
 * passed to the browser context can be provided through the "args" parameter.
 *
 * A crawl will typically fetch and render hundreds of specs, triggering a lot
 * of network requests. Given that some of these requests (e.g. those on images)
 * are of no interest for the processing, that it is wasteful to fetch the same
 * resource again and again during a crawl, and that it is useful to have an
 * offline mode for debugging purpose, the method will intercept network
 * requests made by the browser, fail those that don't seem needed, and serve
 * requests on resources that have already been fetched from a local file cache
 * (the "cacheRefresh" setting in "config.json" allows to adjust this behavior).
 *
 * This triggers a few hiccups and needs for workarounds though:
 * - Puppeteer's page.setRequestInterception does not play nicely with workers
 * (which Respec typically uses) for the time being, so code uses the Chrome
 * DevTools Protocol (CDP) directly, see:
 * https://github.com/puppeteer/puppeteer/issues/4208
 * - Tampering with network requests means that the loaded page gets
 * automatically flagged as "non secure". That's mostly fine but means that
 * "window.crypto.subtle" is not available and Respec needs that to generate
 * hashes. The code re-creates that method manually.
 * - A few specs send HTTP requests that return "streams". This does not work
 * well with Puppeteer's "networkidle0" option (to detect when a spec is mostly
 * done loading), and that does not work with a file cache approach either.
 * These requests get intercepted.
 *
 * A couple of additional notes:
 * - Requests to CSS stylesheets are not intercepted because Respec dynamically
 * loads a few CSS resources, and intercepting them could perhaps impact the
 * rest of the generation.
 * - SVG images are not intercepted because a couple of specs have a PNG
 * fallback mechanism that, when interception is on, make the browser spin
 * forever, see discussion in: https://github.com/w3c/accelerometer/pull/55
 *
 * Strictly speaking, intercepting request is only needed to be able to use the
 * "networkidle0" option. The whole interception logic could be dropped (and
 * "networkidle2" could be used instead) if it proves too unstable.
 *
 * @function
 * @public
 * @param {Object|String} spec The spec to load. Must either be a URL string or
 *   an object with a "url" property. If the object contains an "html" property,
 *   the HTML content is loaded instead.
 * @param {function} callback Processing function that will be evaluated in the
 *   browser context where the spec gets loaded
 * @param {Arrays} args List of arguments to pass to the callback function.
 * @param {Number} counter Counter used to detect infinite loops in cases where
 *   the first URL leads to another
 * @return {Promise} The promise to get the results of the processing function
 */
async function processSpecification(spec, callback, args, counter) {
    spec = (typeof spec === 'string') ? { url: spec } : spec;
    callback = callback || function () {};
    args = args || [];
    counter = counter || 0;
    if (counter >= 5) {
        throw new Error('Infinite loop detected');
    }

    if (!browser) {
        throw new Error('Browser instance not initialized, setupBrowser() must be called before processSpecification().');
    }

    // Create an abort controller for network requests directly handled by the
    // Node.js code (and not by Puppeteer)
    const abortController = new AbortController();

    // Inner function that returns a network interception method suitable for
    // a given CDP session.
    function interceptRequest(cdp, controller) {
        return async function ({ requestId, request }) {
            try {
                if ((request.method !== 'GET') ||
                    (!request.url.startsWith('http:') && !request.url.startsWith('https:'))) {
                    await cdp.send('Fetch.continueRequest', { requestId });
                    return;
                }

                // Abort network requests to common image formats
                if (/\.(gif|ico|jpg|jpeg|png|ttf|woff)$/i.test(request.url)) {
                    await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
                    return;
                }

                // Abort network requests that return a "stream", they won't
                // play well with Puppeteer's "networkidle0" option, and our
                // custom "fetch" function does not handle streams in any case
                if (request.url.startsWith('https://drafts.csswg.org/api/drafts/') ||
                    request.url.startsWith('https://drafts.css-houdini.org/api/drafts/') ||
                    request.url.startsWith('https://drafts.fxtf.org/api/drafts/') ||
                    request.url.startsWith('https://api.csswg.org/shepherd/')) {
                    await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
                    return;
                }

                // The request needs to be intercepted, either because it
                // targets one of the local script files, or because we would
                // like to use our local cache to avoid sending network requests
                // when possible.
                //console.log(`intercept ${request.url}`);
                const reffyPath = '/reffy/scripts/';
                const webidl2Path = '/node_modules/webidl2/';
                if (request.url.includes(reffyPath) || request.url.includes(webidl2Path)) {
                    const file = request.url.includes(reffyPath) ?
                        path.resolve(__dirname, '../browserlib', request.url.substring(request.url.indexOf(reffyPath) + reffyPath.length)) :
                        path.resolve(modulesFolder, 'webidl2', request.url.substring(request.url.indexOf(webidl2Path) + webidl2Path.length));
                    const body = await fs.readFile(file);
                    await cdp.send('Fetch.fulfillRequest', {
                        requestId,
                        responseCode: 200,
                        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
                        body: body.toString('base64')
                    });
                }
                else {
                    const response = await fetch(request.url, { signal: controller.signal });
                    const body = await response.buffer();
                    await cdp.send('Fetch.fulfillRequest', {
                        requestId,
                        responseCode: response.status,
                        responseHeaders: Object.keys(response.headers.raw()).map(header => {
                            return {
                                name: header,
                                value: response.headers.raw()[header].join(',')
                            };
                        }),
                        body: body.toString('base64')
                    });
                }
                //console.log(`intercept ${request.url} - done`);
            }
            catch (err) {
                if (controller.signal.aborted) {
                    // All is normal, processing was over, page and CDP session
                    // have been closed, and network requests have been aborted
                    // console.log(`intercept ${request.url} - aborted`);
                    return;
                }

                // Fetch from file cache failed somehow, report a warning
                // and let Puppeteer handle the request as fallback
                console.warn(`Fall back to regular network request for ${request.url}`, err);
                try {
                    await cdp.send('Fetch.continueRequest', { requestId });
                }
                catch (err) {
                    if (!controller.signal.aborted) {
                        console.warn(`Fall back to regular network request for ${request.url} failed`, err);
                    }
                }
            }
        }
    }

    try {
        const page = await browser.newPage();

        // Intercept all network requests to use our own version of "fetch"
        // that makes use of the local file cache.
        const cdp = await page.target().createCDPSession();
        await cdp.send('Fetch.enable');
        cdp.on('Fetch.requestPaused', interceptRequest(cdp, abortController));

        // Quick and dirty workaround to re-create the "window.crypto.digest"
        // function that Respec needs (context is seen as unsecure because we're
        // tampering with network requests)
        await page.exposeFunction('hashdigest', (algorithm, buffer) => {
            return crypto.createHash(algorithm).update(Buffer.from(Object.values(buffer))).digest();
        });
        await page.evaluateOnNewDocument(() => {
            window.crypto.subtle = {
                digest: function (algorithm, buffer) {
                    const res = window.hashdigest('sha1', buffer);
                    return res.then(buf => {
                        return Uint8Array.from(buf.data);
                    });
                }
            };
        });

        // Common loading option to give the browser enough time to load large
        // specs, and to consider navigation done when there haven't been
        // network connections in the past 500ms. This should be enough to
        // handle "redirection" through JS or meta refresh (which would not
        // have time to run if we used "load").
        const options = {
            timeout: 120000,
            waitUntil: 'networkidle0'
        };

        // Load the page
        if (spec.html) {
            await page.setContent(spec.html, options);
        }
        else {
            await page.goto(spec.url, options);
        }

        // Handle multi-page specs
        const pageUrls = spec.pages || [];

        if (pageUrls.length > 0) {
            const pages = [];
            for (const url of pageUrls) {
                const subAbort = new AbortController();
                const subPage = await browser.newPage();
                const subCdp = await subPage.target().createCDPSession();
                await subCdp.send('Fetch.enable');
                subCdp.on('Fetch.requestPaused', interceptRequest(subCdp, subAbort));
                try {
                    await subPage.goto(url, options);
                    const html = await subPage.evaluate(() => {
                        return document.body.outerHTML
                            .replace(/<body/, '<section')
                            .replace(/<\/body/, '</section');
                    });
                    pages.push({ url, html });
                }
                finally {
                    subAbort.abort();
                    await subCdp.detach();
                    await subPage.close();
                }
            }
            await page.evaluate(pages => {
                for (const subPage of pages) {
                    const section = document.createElement('section');
                    section.setAttribute('data-reffy-page', subPage.url);
                    section.innerHTML = subPage.html;
                    document.body.appendChild(section);
                }
            }, pages);
        }

        // Wait until the generation of the spec is completely over
        await page.evaluate(async () => {
            const usesRespec = (window.respecConfig || window.eval('typeof respecConfig !== "undefined"')) &&
                window.document.head.querySelector("script[src*='respec']");

            function sleep(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            async function isReady(counter) {
                counter = counter || 0;
                if (counter > 60) {
                    throw new Error('Respec generation took too long');
                }
                if (window.document.respecIsReady) {
                    await window.document.respecIsReady;
                }
                else if (usesRespec) {
                    await sleep(1000);
                    await isReady(counter + 1);
                }
            }

            await isReady();
        });

        page.on('pageerror', err => {
            console.error(err);
        });

        // Expose additional functions defined in src/browserlib/ to the
        // browser context, under a window.reffy namespace, so that processing
        // script may call them. The script is an ES6 module and needs to be
        // loaded as such.
        // Note that we're using a fake relative URL on purpose. In practice,
        // the request will be processed by "interceptRequest", which will
        // respond with the contents of the script file. Also, there are two
        // path levels in that fake URL on purpose as well, because scripts
        // import the WebIDL2.js library with a "../../node_modules/[...]" URL.
        await page.addScriptTag({
            url: 'reffy/scripts/reffy.mjs',
            type: 'module'
        });

        // Run the callback method in the browser context
        const results = await page.evaluate(callback, ...args);

        // Pending network requests may still be in the queue, flag the page
        // as closed not to send commands on a CDP session that's no longer
        // attached to anything
        abortController.abort();

        // Close CDP session and page
        // Note that gets done no matter what when browser.close() gets called.
        await cdp.detach();
        await page.close();

        return results;
    }
    finally {
        // Signal abortion again (in case an exception was thrown)
        abortController.abort();
    }
}


/**
 * Short wrapper around the processSpecification method for situations where
 * only one specification needs to be processed.
 *
 * The method takes care of the setup and teardown phases.
 *
 * Same parameters as processSpecification.
 *
 * @function
 * @public
 */
async function processSingleSpecification(spec, callback, args, counter) {
    await setupBrowser();
    const results = await processSpecification(spec, callback, args, counter);
    await teardownBrowser();
    return results;
}


/**
 * Enrich the spec description with alternative URLs (versions and equivalents)
 *
 * TODO: The list used to contain published versions of TR specs retrieved from
 * the W3C API. They are useful to improve the relevance of reported anomalies.
 *
 * @function
 * @param {Object} spec Spec description structure (only the URL is useful)
 * @return {Object} The same structure, enriched with the URL of the editor's
 *   draft when one is found
 */
function completeWithAlternativeUrls(spec) {
    spec.versions = new Set();
    spec.versions.add(spec.url);
    if (spec.release) {
        spec.versions.add(spec.release.url);
    }
    if (spec.nightly) {
        spec.versions.add(spec.nightly.url);
    }
    if (specEquivalents[spec.url]) {
        spec.versions = new Set([
            ...spec.versions,
            ...specEquivalents[spec.url]
        ]);
    }
    spec.versions = [...spec.versions];
    return spec;
}


/**
 * Returns true when the given spec is the latest "fullest" level of that spec
 * in the given list of specs that passes the given predicate.
 *
 * "Fullest" means "not a delta spec, unless that is the only level that passes
 * the predicate".
 *
 * @function
 * @public
 * @param {Object} spec Spec to check
 * @param {Array(Object)} list List of specs (must include the spec to check)
 * @param {function} predicate Predicate function that the spec must pass. Must
 *   be a function that takes a spec as argument and returns a boolean.
 * @return {Boolean} true if the spec is the latest "fullest" level in the list
 *   that passes the predicate.
 */
function isLatestLevelThatPasses(spec, list, predicate) {
    predicate = predicate || (_ => true);
    if (!predicate(spec)) {
        return false;
    }
    if (spec.seriesComposition === 'delta') {
        while (spec.seriesPrevious) {
            spec = list.find(s => s.shortname === spec.seriesPrevious);
            if (!spec) {
                break;
            }
            if ((spec.seriesComposition === 'full') && predicate(spec)) {
                return false;
            }
        }
        return true;
    }
    while (spec.seriesNext) {
        if (!spec) {
            break;
        }
        spec = list.find(s => s.shortname === spec.seriesNext);
        if ((spec.seriesComposition === 'full') && predicate(spec)) {
            return false;
        }
    }
    return true;
}


/**
 * Takes the results of a crawl (typically the contents of the index.json file)
 * and expands it to include the contents of all referenced files.
 *
 * The function handles both files and HTTPS resources, using either filesystem
 * functions (for files) or fetch (for HTTPS resources).
 *
 * Note the crawl object is expanded in place.
 *
 * @function
 * @public
 * @param {Object} crawl Crawl index object that needs to be expanded
 * @param {string} baseFolder The base folder that contains the crawl file, or
 *   the base HTTPS URI to resolve relative links in the crawl object.
 * @return {Promise(object)} The promise to get an expanded crawl object that
 *   contains the entire crawl report (and no longer references external files)
 */
async function expandCrawlResult(crawl, baseFolder) {
    baseFolder = baseFolder || '';

    async function expandSpec(spec) {
        // Special case for "idl" that must be processed first
        if (spec.idl && (typeof spec.idl === 'string')) {
            if (baseFolder.startsWith('https:')) {
                const url = (new URL(spec.idl, baseFolder)).toString();
                let response = await fetch(url, { nolog: true });
                spec.idl = {
                    idl: await response.text()
                };
            }
            else {
                spec.idl = {
                    idl: await fs.readFile(path.join(baseFolder, spec.idl), 'utf8')
                };
            }
        }

        const properties = ['css', 'dfns', 'elements', 'headings', 'ids', 'idlparsed', 'links', 'refs'];
        await Promise.all(properties.map(async property => {
            if (!spec[property] || (typeof spec[property] !== 'string')) {
                return;
            }
            let contents = null;
            if (baseFolder.startsWith('https:')) {
                const url = (new URL(spec[property], baseFolder)).toString();
                const response = await fetch(url, { nolog: true });
                contents = await response.text();
            }
            else {
                const filename = path.join(baseFolder, spec[property]);
                contents = await fs.readFile(filename, 'utf8');
            }
            if (spec[property].endsWith('.json')) {
                contents = JSON.parse(contents);
            }
            if (property === 'css') {
                // Special case for CSS where the "css" level does not exist
                // in the generated files
                const css = Object.assign({}, contents);
                delete css.spec;
                spec[property] = css;
            }
            else if (property === 'idlparsed') {
                // Special case for parsed IDL extracts, as result needs to be
                // attached to "idl"
                if (!spec.idl) {
                    spec.idl = {};
                }
                Object.assign(spec.idl, contents[property]);
                delete spec.idlparsed;
            }
            else {
                spec[property] = contents[property];
            }
        }));
        return spec;
    }

    crawl.results = await Promise.all(crawl.results.map(expandSpec));
    return crawl;
}


/**
 * Retrieves the list of IDL attribute names that the CSS property generates
 * per the CSSOM spec, see:
 * https://drafts.csswg.org/cssom/#ref-for-css-property-to-idl-attribute
 *
 * @function
 * @param {String} property CSS property name
 * @return {Array(String)} An array of IDL attribute names, dashed attribute
 *   first, then camel-cased attribute if different, then webkit-cased attribute
 *   name if needed
 */
function getGeneratedIDLNamesByCSSProperty(property) {
    // Converts a CSS property to an IDL attribute name per the CSSOM spec:
    // https://drafts.csswg.org/cssom/#css-property-to-idl-attribute
    function cssPropertyToIDLAttribute(property, lowercaseFirst) {
        let output = '';
        let uppercaseNext = false;
        if (lowercaseFirst) {
            property = property.substr(1);
        }
        for (const c of property) {
            if (c === '-') {
                uppercaseNext = true;
            } else if (uppercaseNext) {
                uppercaseNext = false;
                output += c.toUpperCase();
            } else {
                output += c;
            }
        }
        return output;
    }

    // Start with dashed attribute
    const res = [property];

    // Add camel-cased attribute if different
    const camelCased = cssPropertyToIDLAttribute(property, false);
    if (camelCased !== property) {
        res.push(camelCased);
    }

    // Add webkit-cased attribute if needed
    if (property.startsWith('-webkit-')) {
        res.push(cssPropertyToIDLAttribute(property, true));
    }

    return res;
};


module.exports = {
    fetch,
    requireFromWorkingDirectory,
    setupBrowser,
    teardownBrowser,
    processSpecification,
    processSingleSpecification,
    completeWithAlternativeUrls,
    isLatestLevelThatPasses,
    expandCrawlResult,
    getGeneratedIDLNamesByCSSProperty
};
