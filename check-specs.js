#!/usr/bin/env node
/**
 * The spec checker crawls a spec (or a list of specs) and creates an anomalies
 * report for it (or for them). The analysis is made against a knowledge base
 * that must also be provided as input under the form of a reference crawl
 * report.
 *
 * Essentially, the spec checker runs the [spec crawler]{@link module:crawler}
 * on the given spec(s), applies the [crawl results merger]{@link module:merger}
 * to update the reference knowledge with the newly crawled results and run the
 * [crawl study]{@link module:study} tool to produce the anomalies report.
 *
 * The spec checker can be called directly through:
 *
 * `node check-specs.js [url] [ref crawl report] [study report] [option]`
 *
 * where `url` is the URL of the spec to check, or a comma-separated value list
 * (without spaces) of URLs, `ref crawl report` is the local name of the
 * reference crawl report file to use as knowledge base, `study report` is the
 * name the of the anomalies report file to create (JSON file), and `option`
 * gives the crawl options (see the spec crawler for details).
 *
 * @module checker
 */

const fs = require('fs');
const requireFromWorkingDirectory = require('./util').requireFromWorkingDirectory;
const crawlList = require('./crawl-specs').crawlList;
const mergeCrawlResults = require('./merge-crawl-results').mergeCrawlResults;
const studyCrawl = require('./study-crawl').studyCrawl;


/**
 * Shortcut that returns a property extractor iterator
 */
const prop = p => x => x[p];


/**
 * Crawl one or more specs and study them against a reference crawl report.
 *
 * The reference crawl report acts as the knowledge database. Knowledge about
 * the specs given as parameter is automatically replaced by the knowledge
 * obtained by crawling these specs.
 *
 * @function
 * @param {Array(Object)} speclist The list of specs to check. Each spec should
 *   have a "url" and/or an "html" property.
 * @param {Object} refCrawl The reference crawl report against which the specs
 *   should be checked
 * @param {Object} options Crawl options
 * @return {Promise} The promise to get the study report for the requested list
 *   of specs
 */
function checkSpecs(speclist, refCrawl, options) {
    return crawlList(speclist, options)
        .then(crawl => {
            return {
                type: 'crawl',
                title: 'Anomalies in spec: ' + speclist.map(prop('url')).join(', '),
                description: 'Study of anomalies in the given spec against a reference crawl report',
                date: (new Date()).toJSON(),
                options: options,
                stats: {
                    crawled: crawl.length,
                    errors: crawl.filter(spec => !!spec.error).length
                },
                results: crawl
            };
        })
        .then(crawl => mergeCrawlResults(crawl, refCrawl))
        .then(mergedCrawl => studyCrawl(mergedCrawl, speclist))
}


/**
 * Crawl the given spec and study it against a reference crawl report.
 *
 * Shortcut for the checkSpecs method when there is only one spec to check.
 *
 * @function
 * @param {Object} spec The spec to check. It should have a "url" and/or an
 *   "html" property.
 * @param {Object} refCrawl The reference crawl report against which the spec
 *   should be checked
 * @param {Object} options Crawl options
 * @return {Promise} The promise to get the study report for the requested spec
 */
function checkSpec(spec, refCrawl, options) {
    return checkSpecs([spec], refCrawl, options);
}


/**************************************************
Export methods for use as module
**************************************************/
module.exports.checkSpecs = checkSpecs;
module.exports.checkSpec = checkSpec;


/**************************************************
Code run if the code is run as a stand-alone module
**************************************************/
if (require.main === module) {
    const specUrls = (process.argv[2] ? process.argv[2].split(',') : [])
        .map(url => { return {url}; });
    const refCrawlPath = process.argv[3];
    const resPath = process.argv[4];
    const crawlOptions = { publishedVersion: (process.argv[5] === 'tr') };

    if (specUrls.length === 0) {
        console.error('URL(s) of the specification(s) to check must be passed as first parameter');
        process.exit(2);
    }
    if (!refCrawlPath) {
        console.error('A reference crawl results must be passed as second parameter');
        process.exit(2);
    }
    if (!resPath) {
        console.error('Result file to create must be passed as third parameter');
        process.exit(3);
    }

    let refCrawl;
    try {
        refCrawl = requireFromWorkingDirectory(refCrawlPath);
    } catch(e) {
        console.error("Impossible to read " + crawlResultsPath + ": " + e);
        process.exit(3);
    }

    checkSpecs(specUrls, refCrawl, crawlOptions)
        .then(study => new Promise((resolve, reject) =>
            fs.writeFile(resPath, JSON.stringify(study, null, 2),
                         err => { if (err) return reject(err); resolve();})))
        .then(_ => console.log('Finished'))
        .catch(err => {
            console.error(err);
            process.exit(64);
        });
}