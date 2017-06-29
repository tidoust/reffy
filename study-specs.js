var array_concat = (a,b) => a.concat(b);
var array_unique = (n, i, a) => a.indexOf(n) === i;

const canonicalizeURL = require('./canonicalize-url');

const matchSpecUrl = url => url.match(/spec.whatwg.org/) || url.match(/www.w3.org\/TR\/[a-z0-9]/) || (url.match(/w3c.github.io/) && ! url.match(/w3c.github.io\/test-results\//));

function processReport(results) {
    var knownIdlNames = results
        .map(r => r.idl && r.idl.idlNames ? Object.keys(r.idl.idlNames).filter(n => n !== "_dependencies") : [], [])
        .reduce(array_concat);
    var idlNamesIndex = {};
    knownIdlNames.forEach(name => {
        idlNamesIndex[name] = results.filter(spec => {
            return spec.idl &&
                spec.idl.idlNames &&
                spec.idl.idlNames[name];
        });
    });

    // TODO: we may end up with different variants of the WebIDL spec
    var WebIDLSpec = results.find(spec => (spec.shortname === 'WebIDL-1')) || {};

    var sortedResults = results.sort((a,b) =>
        a.title.toUpperCase().localeCompare(b.title.toUpperCase()));

    // Construct spec equivalence from the crawl report, which should be more
    // complete than the initial equivalence list.
    var specEquivalents = {};
    sortedResults.forEach(spec =>
        spec.versions.forEach(v => { specEquivalents[v] = spec.url; }
    ));

    // Strong canonicalization options to find references
    var useEquivalents = {
        datedToLatest: true,
        equivalents: specEquivalents
    };

    return sortedResults
        .map(spec => {
            var idlDfns = (spec.idl && spec.idl.idlNames) ?
                Object.keys(spec.idl.idlNames).filter(name => (name !== '_dependencies')) : [];
            var idlDeps = (spec.idl && spec.idl.externalDependencies) ?
                spec.idl.externalDependencies : [];
            var report = {
                error: spec.error,
                hasNormativeRefs: (spec.refs.normative &&
                    (spec.refs.normative.length > 0)),
                referencesWebIDL: (spec.refs.normative &&
                    spec.refs.normative.find(ref =>
                        ref.name.match(/^WebIDL/i) ||
                            (ref.url === WebIDLSpec.url) ||
                            (ref.url === WebIDLSpec.latest))
                ),
                hasIdl: !((Object.keys(spec.idl).length === 0) ||
                    (!spec.idl.idlNames && !spec.idl.message) ||
                    (spec.idl.idlNames &&
                        (Object.keys(spec.idl.idlNames).length === 1) &&
                        (Object.keys(spec.idl.idlExtendedNames).length === 0))),
                hasInvalidIdl: !!(!spec.idl.idlNames && spec.idl.message),
                unknownIdlNames: idlDeps
                    .filter(name => knownIdlNames.indexOf(name) === -1)
                    .sort(),
                redefinedIdlNames: idlDfns
                    .filter(name => (idlNamesIndex[name].length > 1))
                    .map(name => {
                        return {
                            name,
                            refs: idlNamesIndex[name].filter(ref => (ref.url !== spec.url))
                        };
                    }),
                missingWebIdlReferences: idlDeps
                    .filter(name => knownIdlNames.indexOf(name) !== -1)
                    .map(name => {
                        var refs = idlNamesIndex[name];
                        var ref = null;
                        if (spec.refs && spec.refs.normative) {
                            ref = refs.find(s => !!spec.refs.normative.find(r =>
                                (canonicalizeURL(r.url, useEquivalents) === s.url)));
                        }
                        return (ref ? null : {
                            name,
                            refs
                        });
                    })
                    .filter(i => !!i),
                missingReferences: spec.links
                    .filter(matchSpecUrl)
                    .filter(l => {
                        // Filter out "good" and "inconsistent" references
                        let canon = canonicalizeURL(l, useEquivalents);
                        let refs = (spec.refs.normative || []).concat(spec.refs.informative || []);
                        return !refs.find(r => canonicalizeURL(r.url, useEquivalents) === canon);
                    })
                    .filter(l =>
                        // Ignore links to other versions of "self". There may
                        // be cases where it would be worth reporting them but
                        // most of the time they appear in "changelog" sections.
                        (spec.url !== canonicalizeURL(l, useEquivalents)) &&
                        !spec.versions.includes(canonicalizeURL(l, useEquivalents))
                    ),
                inconsistentReferences: spec.links
                    .filter(matchSpecUrl)
                    .map(l => {
                        let canonSimple = canonicalizeURL(l);
                        let canon = canonicalizeURL(l, useEquivalents);
                        let refs = (spec.refs.normative || []).concat(spec.refs.informative || []);

                        // Filter out "good" references
                        if (refs.find(r => canonicalizeURL(r.url) === canonSimple)) {
                            return null;
                        }
                        let ref = refs.find(r => canonicalizeURL(r.url, useEquivalents) === canon);
                        return (ref ? { link: l, ref } : null);
                    })
                    .filter(l => !!l),
                referencedBy: {
                    normative: sortedResults.filter(s =>
                        s.refs.normative && s.refs.normative.find(r =>
                            (spec.url === canonicalizeURL(r.url, useEquivalents)) ||
                            spec.versions.includes(canonicalizeURL(r.url, useEquivalents)))),
                    informative: sortedResults.filter(s =>
                        s.refs.informative && s.refs.informative.find(r =>
                            (spec.url === canonicalizeURL(r.url, useEquivalents)) ||
                            spec.versions.includes(canonicalizeURL(r.url, useEquivalents))))
                }
            };
            report.ok = !report.error &&
                report.hasNormativeRefs &&
                report.hasIdl &&
                !report.hasInvalidIdl &&
                !report.hasObsoleteIdl &&
                report.referencesWebIDL &&
                (!report.unknownIdlNames || (report.unknownIdlNames.length === 0)) &&
                (!report.redefinedIdlNames || (report.redefinedIdlNames.length === 0)) &&
                (!report.missingWebIdlReferences || (report.missingWebIdlReferences.length === 0)) &&
                (report.missingReferences.length === 0) &&
                (report.inconsistentReferences.length === 0);
            var res = {
                title: spec.title,
                shortname: spec.shortname,
                date: spec.date,
                url: spec.url,
                latest: spec.latest,
                report
            };
            return res;
        });
}


function writeCrawlInfo(spec) {
    var w = console.log.bind(console);

    w('Crawl info:');
    w();
    w('- URL: [' + (spec.latest ?
        ((spec.latest.indexOf('www.w3.org/TR/') !== -1) ? 'Latest published version' : 'Editor\'s Draft') :
        ((spec.url.indexOf('spec.whatwg.org') !== -1) ? 'Living Standard' : 'Initial URL'))
        + '](' + (spec.latest || spec.url) + ')');
    w('- Shortname: ' + (spec.shortname || 'no shortname'));
    w('- Date: ' + (spec.date || 'unknown'));
}


function generateReportPerSpec(results) {
    var count = 0;
    var w = console.log.bind(console);

    // Compute report information
    results = processReport(results);

    w('# Reffy crawl report');
    w();
    w('## Specifications without known issues');
    w();
    count = 0;
    results
        .filter(spec => spec.report.ok)
        .forEach(spec => {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        });
    w();
    w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
    w();
    w();

    let parsingErrors = results.filter(spec => spec.report.error);
    if (parsingErrors.length > 0) {
        w('## Specifications that could not be parsed');
        w();
        count = 0;
        parsingErrors.forEach(spec => {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        });
        w();
        w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
        w();
        w();
    }

    w('## Specifications with possible issues');
    w();
    results
        .filter(spec => !spec.report.ok && !spec.report.error)
        .forEach(spec => {
            w('### ' + spec.title);
            w();
            writeCrawlInfo(spec);
            w();

            var report = spec.report;
            w('Potential issue(s):');
            w();
            if (!report.hasNormativeRefs) {
                w('- No normative references found');
            }
            if (!report.hasIdl) {
                w('- No WebIDL definitions found');
            }
            if (report.hasInvalidIdl) {
                w('- Invalid WebIDL content found');
            }
            if (report.hasObsoleteIdl) {
                w('- Obsolete WebIDL constructs found');
            }
            if (report.hasIdl && !report.referencesWebIDL) {
                w('- Spec uses WebIDL but does not reference it normatively');
            }
            if (report.unknownIdlNames &&
                (report.unknownIdlNames.length > 0)) {
                w('- Unknown WebIDL names used: ' +
                    report.unknownIdlNames.map(name => '`' + name + '`').join(', '));
            }
            if (report.redefinedIdlNames &&
                (report.redefinedIdlNames.length > 0)) {
                w('- WebIDL names also defined elsewhere: ');
                report.redefinedIdlNames.map(i => {
                    w('    * `' + i.name + '` also defined in ' +
                        i.refs.map(ref => ('[' + ref.title + '](' + (ref.latest || ref.url) + ')')).join(' and '));
                });
            }
            if (report.missingWebIdlReferences &&
                (report.missingWebIdlReferences.length > 0)) {
                w('- Missing references for WebIDL names: ');
                report.missingWebIdlReferences.map(i => {
                    w('     * `' + i.name + '` defined in ' +
                        i.refs.map(ref => ('[' + ref.title + '](' + (ref.latest || ref.url) + ')')).join(' or '));
                });
            }
            if (report.missingReferences &&
                (report.missingReferences.length > 0)) {
                w('- Missing references for links: ');
                report.missingReferences.map(l => {
                    w('     * [`' + l + '`](' + l + ')');
                });
            }
            if (report.inconsistentReferences &&
                (report.inconsistentReferences.length > 0)) {
                w('- Inconsistent references for links: ');
                report.inconsistentReferences.map(l => {
                    w('     * [`' + l.link + '`](' + l.link + '), related reference "' + l.ref.name + '" uses URL [`' + l.ref.url + '`](' + l.ref.url + ')');
                });
            }
            w();
            w();
        });
    w();
    w();
}


function generateReport(results) {
    var count = 0;
    var w = console.log.bind(console);

    // Compute report information
    results = processReport(results);

    w('# Reffy crawl report');
    w();

    w('## Specifications crawled');
    w();
    count = results.length;
    w('- ' + count + ' specification' + ((count > 1) ? 's' : '') + ' crawled');
    w();
    w();

    let parsingErrors = results.filter(spec => spec.report.error);
    if (parsingErrors.length > 0) {
        w('## Specifications that could not be parsed');
        w();
        count = 0;
        parsingErrors.forEach(spec => {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        });
        w();
        w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
        w();
        w();

        // Remove specs that could not be parsed from the rest of the report
        results = results.filter(spec => !spec.report.error);
    }

    count = 0;
    w('## Specifications without normative dependencies');
    w();
    results
        .filter(spec => !spec.report.hasNormativeRefs)
        .forEach(spec => {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        });
    w();
    w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
    w();
    w('**NB:** it may be normal!');
    w();
    w();

    count = 0;
    w('## Specifications without WebIDL definitions');
    w();
    results
        .filter(spec => !spec.report.hasIdl)
        .forEach(spec => {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        });
    w();
    w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
    w();
    w();

    count = 0;
    w('## List of specifications with invalid WebIDL content');
    w();
    results
        .filter(spec => spec.report.hasInvalidIdl)
        .forEach(spec => {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        });
    w();
    w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
    w();
    w('**NB:** this may be due to WebIDL having evolved in the meantime');
    w();
    w();

    count = 0;
    w('## List of specifications with obsolete WebIDL constructs');
    w();
    results
        .filter(spec => spec.report.hasObsoleteIdl)
        .forEach(spec => {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        });
    w();
    w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
    w();
    w();

    count = 0;
    w('## Specifications that use WebIDL but do not reference the WebIDL spec');
    w();
    results.forEach(spec => {
        if (spec.report.hasIdl && !spec.report.referencesWebIDL) {
            count += 1;
            w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')');
        }
    });
    w();
    w('=> ' + count + ' specification' + ((count > 1) ? 's' : '') + ' found');
    w();
    w();


    count = 0;
    w('## List of WebIDL names not defined in the specifications crawled');
    w();
    var idlNames = {};
    results.forEach(spec => {
        if (!spec.report.unknownIdlNames ||
            (spec.report.unknownIdlNames.length === 0)) {
            return;
        }
        spec.report.unknownIdlNames.forEach(name => {
            if (!idlNames[name]) {
                idlNames[name] = [];
            }
            idlNames[name].push(spec);
        });
    });
    Object.keys(idlNames).sort().forEach(name => {
        count += 1;
        w('- `' + name + '` used in ' +
            idlNames[name].map(ref => ('[' + ref.title + '](' + (ref.latest || ref.url) + ')')).join(', '));
    });
    w();
    w('=> ' + count + ' WebIDL name' + ((count > 1) ? 's' : '') + ' found');
    w();
    w('**NB:** some of them are likely type errors in specs');
    w('(e.g. "int" does not exist, "Array" cannot be used on its own, etc.)');
    w();
    w();

    count = 0;
    w('## List of WebIDL names defined in more than one spec');
    w();
    idlNames = {};
    results.forEach(spec => {
        if (!spec.report.redefinedIdlNames ||
            (spec.report.redefinedIdlNames.length === 0)) {
            return;
        }
        spec.report.redefinedIdlNames.forEach(i => {
            if (!idlNames[i.name]) {
                idlNames[i.name] = [];
            }
            idlNames[i.name].push(spec);
        });
    });
    Object.keys(idlNames).sort().forEach(name => {
        count += 1;
        w('- `' + name + '` defined in ' +
            idlNames[name].map(ref => ('[' + ref.title + '](' + (ref.latest || ref.url) + ')')).join(' and '));
    });
    w();
    w('=> ' + count + ' WebIDL name' + ((count > 1) ? 's' : '') + ' found');
    w();
    w();

    count = 0;
    var countrefs = 0;
    w('## Missing references for WebIDL names');
    w();
    results.forEach(spec => {
        if (spec.report.missingWebIdlReferences &&
            (spec.report.missingWebIdlReferences.length > 0)) {
            count += 1;
            if (spec.report.missingWebIdlReferences.length === 1) {
                countrefs += 1;
                let i = spec.report.missingWebIdlReferences[0];
                w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')' +
                    ' uses `' + i.name + '` but does not reference ' +
                    i.refs.map(ref => ('[' + ref.title + '](' + (ref.latest || ref.url) + ')')).join(' or '));
            }
            else {
                w('- [' + spec.title + '](' + (spec.latest || spec.url) + ') uses:');
                spec.report.missingWebIdlReferences.map(i => {
                    countrefs += 1;
                    w('    * `' + i.name + '` but does not reference ' +
                        i.refs.map(ref => ('[' + ref.title + '](' + (ref.latest || ref.url) + ')')).join(' or '));
                });
            }
        }
    });
    w();
    w('=> ' + countrefs + ' missing reference' + ((countrefs > 1) ? 's' : '') +
      ' for IDL definitions found in ' + count + ' specification' +
      ((count > 1) ? 's' : ''));
    w();
    w();

    count = 0;
    countrefs = 0;
    w('## Missing references based on document links');
    w();
    results.forEach(spec => {
        if (spec.report.missingReferences &&
            (spec.report.missingReferences.length > 0)) {
            count += 1;
            if (spec.report.missingReferences.length === 1) {
                countrefs += 1;
                let l = spec.report.missingReferences[0];
                w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')' +
                  ' links to [`' + l + '`](' + l + ') but does not list it' +
                  ' in its references');
            }
            else {
                w('- [' + spec.title + '](' + (spec.latest || spec.url) + ') links to:');
                spec.report.missingReferences.forEach(l => {
                    countrefs++;
                    w('    * [`' + l + '`](' + l + ') but does not list it ' +
                      'in its references');
                });
            }
        }
    });
    w();
    w('=> ' + countrefs + ' missing reference' + ((countrefs > 1) ? 's' : '') +
      ' for links found in ' + count + ' specification' +
      ((count > 1) ? 's' : ''));
    w();
    w();

    count = 0;
    countrefs = 0;
    w('## Reference URL is inconsistent with URL used in document links');
    w();
    results.forEach(spec => {
        if (spec.report.inconsistentReferences &&
            (spec.report.inconsistentReferences.length > 0)) {
            count += 1;
            if (spec.report.inconsistentReferences.length === 1) {
                countrefs += 1;
                let l = spec.report.inconsistentReferences[0];
                w('- [' + spec.title + '](' + (spec.latest || spec.url) + ')' +
                  ' links to [`' + l.link + '`](' + l.link + ') but related reference "' + l.ref.name + '" uses URL [`' + l.ref.url + '`](' + l.ref.url + ')');
            }
            else {
                w('- [' + spec.title + '](' + (spec.latest || spec.url) + ') links to:');
                spec.report.inconsistentReferences.forEach(l => {
                    countrefs++;
                    w('    * [`' + l.link + '`](' + l.link + ') but related reference "' + l.ref.name + '" uses URL [`' + l.ref.url + '`](' + l.ref.url + ')');
                });
            }
        }
    });
    w();
    w('=> ' + countrefs + ' inconsistent reference' + ((countrefs > 1) ? 's' : '') +
      ' for links found in ' + count + ' specification' +
      ((count > 1) ? 's' : ''));

}


function generateDependenciesReport(results) {
    var count = 0;
    var w = console.log.bind(console);

    // Compute report information
    results = processReport(results);

    w('# Reffy dependencies report');
    w();
    results.forEach(spec => {
        w('## ' + spec.title);
        w();
        writeCrawlInfo(spec);
        w();
        if (spec.report.referencedBy.normative.length > 0) {
            w('Normative references to this spec from:');
            w();
            spec.report.referencedBy.normative.forEach(s => {
                w('- [' + s.title + '](' + (s.latest || s.url) + ')');
            });
        }
        else {
            w('No normative reference to this spec from other specs.');
        }
        w();

        if (spec.report.referencedBy.informative.length > 0) {
            w('Informative references to this spec from:');
            w();
            spec.report.referencedBy.informative.forEach(s => {
                w('- [' + s.title + '](' + (s.latest || s.url) + ')');
            });
        }
        else {
            w('No informative reference to this spec from other specs.');
        }
        w();
        w();
    });
}


/**************************************************
Code run if the code is run as a stand-alone module
**************************************************/
if (require.main === module) {
    var specResultsPath = process.argv[2];
    var perSpec = !!process.argv[3] || (process.argv[3] === 'perspec');
    var depReport = (process.argv[3] === 'dep');
    if (!specResultsPath) {
        console.error("Required filename parameter missing");
        process.exit(2);
    }
    var specResults;
    try {
        specResults = require(specResultsPath);
    } catch(e) {
        console.error("Impossible to read " + specresultsPath + ": " + e);
        process.exit(3);
    }
    if (depReport) {
        generateDependenciesReport(specResults);
    }
    else if (perSpec) {
        generateReportPerSpec(specResults);
    }
    else {
        generateReport(specResults);
    }
}
