/* File generated with rollup.js, do not edit directly! See source code in src/browserlib */
(function () {
  'use strict';

  /**
   * Gets the title of the document
   */
  function getTitle () {
    const title = window.document.querySelector('title');
    if (title) {
      return title.textContent.trim();
    }
    else {
      return '[No title found for ' + window.location.href + ']';
    }
  }

  /**
   * Return the name of a well-known generator that was used to generate the
   * spec, if known.
   *
   * This function expects to run within a browser context.
   *
   * @function
   * @public
   * @param {Window} window
   * @return {Promise} The promise to get a document ready for extraction and
   *   the name of the generator (or null if generator is unknown).
   */
  function getGenerator () {
      const generator = window.document.querySelector('meta[name="generator"]');
      if (generator && generator.content.match(/bikeshed/i)) {
          return 'bikeshed';
      }
      else if ((generator && generator.content.match(/respec/i)) ||
              (document.body.id === 'respecDocument') ||
              window.respecConfig ||
              window.eval('typeof respecConfig !== "undefined"')) {
          return 'respec';
      }
      else if (document.getElementById('anolis-references')) {
          return 'anolis';
      }
      else {
          return null;
      }
  }

  function getLastModifiedDate () {
    const dateEl = document.querySelector('.head time');
    const statusAndDate = [...document.querySelectorAll('.head h2')]
      .map(el => el.textContent).join(' ').trim();
    const lastModified = new Date(Date.parse(document.lastModified));
    const date = dateEl ? dateEl.textContent.trim() :
      (statusAndDate ? statusAndDate.split(/\s+/).slice(-3).join(' ') :
      [
        lastModified.toLocaleDateString('en-US', { day: 'numeric' }),
        lastModified.toLocaleDateString('en-US', { month: 'long' }),
        lastModified.toLocaleDateString('en-US', { year: 'numeric' })
      ].join(' '));
    return date;
  }

  /**
   * Extract the list of WebIDL definitions in the current spec
   *
   * @function
   * @public 
   * @return {Promise} The promise to get a dump of the IDL definitions, or
   *   an empty string if the spec does not contain any IDL.
   */
  function extractWebIdl () {
      const generator = getGenerator();
      if (generator === 'bikeshed') {
          return extractBikeshedIdl();
      }
      else if (document.title.startsWith('Web IDL')) {
          // IDL content in the Web IDL spec are... examples,
          // not real definitions
          return '';
      }
      else {
          // Most non-ReSpec specs still follow the ReSpec conventions
          // for IDL definitions
          return extractRespecIdl();
      }
  }


  /**
   * Extract IDL definitions from a Bikeshed spec
   *
   * Note Bikeshed summarizes IDL definitions in an appendix. This is
   * what the code uses.
   */
  function extractBikeshedIdl() {
      const idlHeading = document.getElementById('idl-index');
      if (idlHeading) {
          const nextEl = idlHeading.nextElementSibling;
          if (nextEl) {
              return nextEl.textContent;
          }
          else {
              throw new Error('Could not find IDL in IDL index');
          }
      }
      else {
          // the document may have been generated with "omit idl-index"
          // in which case, we try the simple way
          return extractRespecIdl();
      }
  }


  /**
   * Extract IDL definitions from a ReSpec spec, and in practice from
   * most other specs as well.
   *
   * The function tries all known patterns used to define IDL content, making
   * sure that it only extracts elements once.
   */
  function extractRespecIdl() {
      // IDL filter voluntarily similar to that defined in Respec to exclude
      // IDL defined with an `exclude` class:
      // https://github.com/w3c/respec/blob/develop/src/core/utils.js#L69
      // https://tabatkins.github.io/bikeshed/#metadata-informative-classes
      const nonNormativeSelector = [
          '.informative', '.note', '.issue', '.example', '.ednote', '.practice',
          '.introductory', '.non-normative'
      ].join(',');

      // Helper function that trims individual lines in an IDL block,
      // removing as much space as possible from the beginning of the page
      // while preserving indentation. Rules followed:
      // - Always trim the first line
      // - Remove whitespaces from the end of each line
      // - Replace lines that contain spaces with empty lines
      // - Drop same number of leading whitespaces from all other lines
      const trimIdlSpaces = idl => {
          const lines = idl.trim().split('\n');
          const toRemove = lines
              .slice(1)
              .filter(line => line.search(/\S/) > -1)
              .reduce(
                  (min, line) => Math.min(min, line.search(/\S/)),
                  Number.MAX_VALUE);
          return lines
              .map(line => {
                  let firstRealChat = line.search(/\S/);
                  if (firstRealChat === -1) {
                      return '';
                  }
                  else if (firstRealChat === 0) {
                      return line.replace(/\s+$/, '');
                  }
                  else {
                      return line.substring(toRemove).replace(/\s+$/, '');
                  }
              })
              .join('\n');
      };

      // Detect the IDL index appendix if there's one (to exclude it)
      const idlEl = document.querySelector('#idl-index pre') ||
          document.querySelector('.chapter-idl pre'); // SVG 2 draft

      let idl = [
          'pre.idl:not(.exclude):not(.extract):not(#actual-idl-index)',
          'pre:not(.exclude):not(.extract) > code.idl-code:not(.exclude):not(.extract)',
          'pre:not(.exclude):not(.extract) > code.idl:not(.exclude):not(.extract)',
          'div.idl-code:not(.exclude):not(.extract) > pre:not(.exclude):not(.extract)',
          'pre.widl:not(.exclude):not(.extract)'
      ]
          .map(sel => [...document.querySelectorAll(sel)])
          .reduce((res, elements) => res.concat(elements), [])
          .filter(el => el !== idlEl)
          .filter((el, idx, self) => self.indexOf(el) === idx)
          .filter(el => !el.closest(nonNormativeSelector))
          .map(el => el.cloneNode(true))
          .map(el => {
              const header = el.querySelector('.idlHeader');
              if (header) {
                  header.remove();
              }
              const tests = el.querySelector('details.respec-tests-details');
              if (tests) {
                  tests.remove();
              }
              return el;
          })
          .map(el => trimIdlSpaces(el.textContent))
          .join('\n\n');

      return idl;
  }

  /**
   * Extract the list of CSS definitions in the current spec
   *
   * @function
   * @public 
   * @return {Promise} The promise to get an extract of the CSS definitions, or
   *   an empty CSS description object if the spec does not contain any CSS
   *   definition. The return object will have properties named "properties",
   *  "descriptors", and "valuespaces".
   */
  function extractCSS () {
    let res = {
      properties: extractTableDfns(document, 'propdef'),
      descriptors: extractTableDfns(document, 'descdef'),
      valuespaces: extractValueSpaces(document)
    };

    // Try old recipes if we couldn't extract anything
    if ((Object.keys(res.properties).length === 0) &&
        (Object.keys(res.descriptors).length === 0)) {
      res.properties = extractDlDfns(document, 'propdef');
      res.descriptors = extractDlDfns(document, 'descdef');
    }

    return res;
  }


  /**
   * Converts a definition label as it appears in a CSS spec to a lower camel
   * case property name.
   *
   * @param  {String} label Definition label
   * @return {String} lower camel case property name for the label
   */
  const dfnLabel2Property = label => label.trim()
    .replace(/:/, '')
    .split(' ')
    .map((str, idx) => (idx === 0) ?
      str.toLowerCase() :
      str.charAt(0).toUpperCase() + str.slice(1))
    .join('');


  /**
   * Extract a CSS definition from a table
   *
   * All recent CSS specs should follow that pattern
   */
  const extractTableDfn = table => {
    let res = {};
    const lines = [...table.querySelectorAll('tr')]
      .map(line => Object.assign({
        name: dfnLabel2Property(line.querySelector(':first-child').textContent),
        value: line.querySelector('td:last-child').textContent.trim().replace(/\s+/g, ' ')
      }));
    for (let prop of lines) {
      res[prop.name] = prop.value;
    }
    return res;
  };


  /**
   * Extract a CSS definition from a dl list
   *
   * Used in "old" CSS specs
   */
  const extractDlDfn = dl => {
    let res = {};
    res.name = dl.querySelector('dt').textContent.replace(/'/g, '').trim();
    const lines = [...dl.querySelectorAll('dd table tr')]
      .map(line => Object.assign({
        name: dfnLabel2Property(line.querySelector(':first-child').textContent),
        value: line.querySelector('td:last-child').textContent.trim().replace(/\s+/g, ' ')
      }));
    for (let prop of lines) {
      res[prop.name] = prop.value;
    }
    return res;
  };


  /**
   * Extract CSS definitions in a spec using the given CSS selector and extractor
   */
  const extractDfns = (doc, selector, extractor) => {
    let res = {};
    [...doc.querySelectorAll(selector)]
      .map(extractor)
      .filter(dfn => !!dfn.name)
      .map(dfn => dfn.name.split(',').map(name => Object.assign({},
        dfn, { name: name.trim() })))
      .reduce((acc, val) => acc.concat(val), [])
      .forEach(dfn => {
        if ((dfn.name === 'property-name') ||
            (dfn.name === '--*')) {
          // Ignore sample definition && custom properties definition
          return;
        }
        res[dfn.name] = dfn;
      });
    return res;
  };


  /**
   * Extract CSS definitions in tables for the given class name
   * (typically one of `propdef` or `descdef`)
   */
  const extractTableDfns = (doc, className) =>
    extractDfns(doc, 'table.' + className + ':not(.attrdef)', extractTableDfn);


  /**
   * Extract CSS definitions in a dl list for the given class name
   * (typically one of `propdef` or `descdef`)
   */
  const extractDlDfns = (doc, className) =>
    extractDfns(doc, 'div.' + className + ' dl', extractDlDfn);


  /**
   * Extract value spaces (non-terminal values) defined in the specification
   */
  const extractValueSpaces = doc => {
    let res = {};

    const parseProductionRules = rules =>
      rules
        .map(val => val.split(/\n(?=[^\n]*\s?=\s)/m))
        .reduce((acc, val) => acc.concat(val), [])
        .map(line => line.split(/\s?=\s/).map(s => s.trim().replace(/\s+/g, ' ')))
        .filter(val => val[0].match(/^<.*>$|^.*\(\)$/))
        .filter(val => !!val[1])
        .forEach(val => res[val[0].replace(/^(.*\(\))$/, '<$1>')] = {
          value: val[1]
        });

    // Extract non-terminal value spaces defined in `pre` tags
    // (remove note references as in:
    // https://drafts.csswg.org/css-syntax-3/#the-anb-type)
    parseProductionRules([...doc.querySelectorAll('pre.prod')]
      .map(el => {
        [...el.querySelectorAll('sup')]
          .map(sup => sup.parentNode.removeChild(sup));
        return el;
      })
      .map(el => el.textContent));

    // Complete with non-terminal value spaces defined in `pre` tags without
    // an explicit class, as in:
    // https://drafts.fxtf.org/compositing-1/#ltblendmodegt
    parseProductionRules([...doc.querySelectorAll('pre:not(.idl)')]
      .filter(el => el.querySelector('dfn'))
      .map(el => el.textContent));

    // Complete with non-terminal value spaces defined in `dt` tags, as in:
    // https://drafts.csswg.org/css-shapes-1/#funcdef-inset
    // https://drafts.csswg.org/css-transforms/#funcdef-transform-matrix
    parseProductionRules([...doc.querySelectorAll('dt > dfn.css, dt > span.prod > dfn.css')]
      .filter(el => el.parentNode.textContent.match(/\s?=\s/))
      .map(el => el.parentNode.textContent));

    // Complete with function values defined in `dt` tags where definition and
    // value are mixed together, as in:
    // https://drafts.csswg.org/css-overflow-4/#funcdef-text-overflow-fade
    parseProductionRules([...doc.querySelectorAll('dt > dfn.css')]
      .filter(el => el.parentNode.textContent.trim().match(/^[a-zA-Z_][a-zA-Z0-9_\-]+\([^\)]*\)$/))
      .map(el => {
        let fn = el.parentNode.textContent.trim()
          .match(/^([a-zA-Z_][a-zA-Z0-9_\-]+)\([^\)]*\)$/)[1];
        return fn + '() = ' + el.parentNode.textContent;
      }));


    // Complete with non-terminal value spaces defined in `.definition`
    // paragraphs, as in:
    // https://svgwg.org/svg2-draft/painting.html#DataTypeDasharray
    parseProductionRules([...doc.querySelectorAll('.definition > dfn')]
      .filter(el => el.parentNode.textContent.match(/\s?=\s/))
      .map(el => el.parentNode.textContent));

    // Complete with non-terminal value spaces defined in simple paragraphs,
    // as in:
    // https://drafts.csswg.org/css-animations-2/#typedef-single-animation-composition
    // https://drafts.csswg.org/css-transitions/#single-transition-property
    parseProductionRules([...doc.querySelectorAll('p > dfn, div.prod > dfn')]
      .filter(el => el.parentNode.textContent.trim().match(/^<.*>\s?=\s/))
      .map(el => el.parentNode.textContent));

    // Complete with non-terminal value spaces defined in `dt` tags with
    // production rules (or prose) in `dd` tags, as in:
    // https://drafts.csswg.org/css-fonts/#absolute-size-value
    // https://drafts.csswg.org/css-content/#typedef-content-content-list
    [...doc.querySelectorAll('dt > dfn, dt > var')]
      .filter(el => el.textContent.trim().match(/^<.*>$/))
      .filter(el => {
        let link = el.querySelector('a[href]');
        if (!link) {
          return true;
        }
        let href = (link ? link.getAttribute('href') : null);
        return (href === '#' + el.getAttribute('id'));
      })
      .map(el => {
        let dd = el.parentNode;
        while (dd && (dd.nodeName !== 'DD')) {
          dd = dd.nextSibling;
        }
        if (!dd) {
          return null;
        }
        let code = dd.querySelector('p > code, pre.prod');
        if (code) {
          return {
            name: el.textContent.trim(),
            value: code.textContent.trim().replace(/\s+/g, ' ')
          }
        }
        else {
          return {
            name: el.textContent.trim(),
            prose: dd.textContent.trim().replace(/\s+/g, ' ')
          };
        }
      })
      .filter(space => !!space)
      .forEach(space => {
        res[space.name] = {};
        if (space.prose) {
          res[space.name].prose = space.prose;
        }
        if (space.value) {
          res[space.name].value = space.value;
        }
      });

    return res;
  };

  /**
   * Extract definitions in the spec that follow the "Definitions data model":
   * https://tabatkins.github.io/bikeshed/#dfn-contract
   *
   * Each definition returned by the function will have the following properties:
   * - id: The local ID in the DOM. Should be unique within a spec page.
   * - href: The absolute URL to the definition.
   * - linkingText: List of linking phrases for references.
   * - localLinkingText: List of linking phrases for local references only.
   * - type: The definition type. One of the values in
   *     https://tabatkins.github.io/bikeshed/#dfn-types
   * - for: The list of namespaces for the definition
   * - access: "public" when definition can be referenced by other specifications,
   *     "private" when it should be viewed as a local definition.
   * - informative: true when definition appears in an informative section,
   *     false if it is normative
   *
   * @function
   * @public
   * @return {Array(Object)} An Array of definitions
  */
  function extractDefinitions () {
    const definitionsSelector = [
      'dfn[id]',
      'h2[id][data-dfn-type]',
      'h3[id][data-dfn-type]',
      'h4[id][data-dfn-type]',
      'h5[id][data-dfn-type]',
      'h6[id][data-dfn-type]'
    ].join(',');

    return [...document.querySelectorAll(definitionsSelector)]
      .map(el => Object.assign({
        // ID is the id attribute
        id: el.getAttribute('id'),

        // Compute the absolute URL
        // (Note the crawler merges pages of a multi-page spec in the first page
        // to ease parsing logic, and we want to get back to the URL of the page)
        href: (_ => {
          const pageWrapper = el.closest('[data-reffy-page]');
          const url = new URL(pageWrapper ?
            pageWrapper.getAttribute('data-reffy-page') : window.location.href);
          url.hash = '#' + el.getAttribute('id');
          return url.toString();
        })(),

        // Linking text is given by the data-lt attribute if present, or it is the
        // textual content
        linkingText: el.hasAttribute('data-lt') ?
          el.getAttribute('data-lt').split('|').map(s => s.trim()) :
          [el.textContent.trim()],

        // Additional linking text can be defined for local references
        localLinkingText: el.getAttribute('data-local-lt') ?
          el.getAttribute('data-local-lt').split('|').map(s => s.trim()) :
          [],

        // Link type must be specified, or it is "dfn"
        type: el.getAttribute('data-dfn-type') || 'dfn',

        // Definition may be namespaced to other constructs. Note the list is not
        // purely comma-separated due to function parameters. For instance,
        // attribute value may be "method(foo,bar), method()"
        for: el.getAttribute('data-dfn-for') ?
          el.getAttribute('data-dfn-for').split(/,(?![^\(]*\))/).map(s => s.trim()) :
          [],

        // Definition is public if explictly marked as exportable or if export has
        // not been explicitly disallowed and its type is not "dfn"
        access: (el.hasAttribute('data-export') ||
            (!el.hasAttribute('data-noexport') &&
              el.hasAttribute('data-dfn-type') &&
              el.getAttribute('data-dfn-type') !== 'dfn')) ?
          'public' : 'private',

        // Whether the term is defined in a normative/informative section,
        // provided the wrapping section follows usual patterns:
        // https://github.com/w3c/respec/blob/develop/src/core/utils.js#L69
        // https://tabatkins.github.io/bikeshed/#metadata-informative-classes
        informative: !!el.closest([
          '.informative', '.note', '.issue', '.example', '.ednote', '.practice',
          '.introductory', '.non-normative'
        ].join(','))
      }));
  }

  /**
   * Extract the list of references from the "References" appendix of the
   * current document.
   *
   * Notes:
   * - By definition, this function does not return the specifications that
   * the current document references in the prose but failed to add to the
   * "References" appendix.
   * - The function throws when no references could be found
   *
   * @function
   * @public 
   * @return {Object} An object with a "normative" and/or an "informative"
   *   property that list references as they appear in the "References".
   */
  function extractReferences () {
    const generator = getGenerator();
    const extractionRules = getExtractionRules(generator);
    const references = extractReferences$1(extractionRules);
    return references;
  }



  /**
   * Given the name of the generator used to create the document,
   * return the rules to use to extract references.
   *
   * @function
   * @private
   * @param {String} generator The well-known generator used to create the doc,
   *   null if unknown
   * @return {Object} Relevant extraction rules (or null if no rules seem to apply).
   */
  function getExtractionRules(generator) {
    const extractionRules = {
      bikeshed: {
        generator: "Bikeshed",
        listSelector: {
          normative: "#normative + dl",
          informative: "#informative + dl"
        }
      },
      respec: {
        generator: "ReSpec",
        listSelector: {
          normative: "#normative-references > dl",
          informative: "#informative-references > dl"
        }
      },
      anolis: {
        generator: "Anolis",
        listSelector: {
          normative: "#anolis-references > dl"
        }
      },
    };

    return (generator ? extractionRules[generator] : null);
  }


  /**
   * Skip next siblings until another tag with the given name is found
   *
   * @function
   * @private
   * @param {Node} node The DOM node to use as starting point
   * @param {String} name The sibling name to find
   * @return {Node} The next sibling with the given name, null if not found
   */
  function nextTag(node, name) {
    let nextEl = node.nextElementSibling;
    while(nextEl && nextEl.tagName !== name.toUpperCase()) {
      nextEl = nextEl.nextElementSibling;
    }
    return nextEl;
  }


  /**
   * Given a markup definition list, parse and return the list of references
   *
   * @function
   * @param {Node} referenceList The "dl" to parse
   * @param {Object} options Parsing options, set "filterInformative" to put
   *   references flagged as "non-normative" to a separate returned list
   * @return {Array} An array whose first item is the list of references and the
   *   second item the list of "non-normative" references (the second item is only
   *   set when "filterInformative" is set)
   */
  function parseReferences(referenceList, options) {
    var defaultRef = [], informativeRef = [];
    options = options || {};
    [].forEach.call(referenceList.querySelectorAll("dt"), function (dt) {
      var ref = {};
      ref.name = dt.textContent.replace(/[\[\] \n]/g, '');
      var desc = nextTag(dt, "dd");
      if (!desc || !ref.name) {
        return;
      }
      ref.url = desc.querySelector("a[href]") ? desc.querySelector("a[href]").href : "";
      if (options.filterInformative &&
          desc.textContent.match(/non-normative/i)) {
        return informativeRef.push(ref);
      }
      defaultRef.push(ref);
    });
    return [defaultRef, informativeRef];
  }
  const textMatch = re => n => n.textContent.match(re);

  /**
   * Extract references from generic documents that we could not associate with
   * any particular set of extraction rules.
   *
   * @function
   * @private
   * @return {Object} A list of references.
   */
  function extractReferencesWithoutRules() {
    const references = {
      normative: [],
      informative: []
    };
    const anchors = [...document.querySelectorAll("h1, h2, h3")];
    const referenceHeadings = anchors.filter(textMatch(/references/i));
    if (!referenceHeadings.length) {
      return references;
    }
    if (referenceHeadings.length > 1) {
      const normative = referenceHeadings.find(textMatch(/normative/i));
      if (normative) {
        const nList = nextTag(normative, "dl");
        if (nList) {
          references.normative = parseReferences(nList)[0];
        }
      }
      const informative = referenceHeadings.find(textMatch(/informative/i));
      if (informative) {
        const iList = nextTag(informative, "dl");
        if (iList) {
          references.informative = parseReferences(iList)[0];
        }
      }
      if (informative || normative) {
        return references;
      }
    }

    // If there are still multiple reference headings,
    // keep only the last one
    const referenceHeading = referenceHeadings.pop();
    const list = nextTag(referenceHeading, "dl");
    if (list) {
      const refs = parseReferences(list, { filterInformative: true });
      references.normative = refs[0];
      references.informative = refs[1];
    }
    return references;
  }


  /**
   * Extract references from the given document
   *
   * @function
   * @private
   * @param {Object} rules Extraction rules to use
   * @return {Object} A list of references.
   */
  function extractReferences$1(rules) {
    if (!rules) {
      return extractReferencesWithoutRules();
    }
    if (!rules.listSelector ||
        !rules.listSelector.normative) {
      throw new Error("Extraction rules for the list of references are incorrect");
    }
    const generator = rules.generator || "an unknown generator";

    const references = {
      normative: [],
      informative: []
    };
    ["normative", "informative"].forEach(function (referenceType) {
      const referenceList = document.querySelector(rules.listSelector[referenceType]);
      if (referenceList) {
        const refs = parseReferences(referenceList, {
          filterInformative: (referenceType === "normative")
        });
        references[referenceType] = references[referenceType].concat(refs[0]);
        if (referenceType === "normative") {
            references.informative = references.informative.concat(refs[1]);
        }
      }
    });

    return references;
  }

  /**
   * Return a canonicalized version of the given URL.
   *
   * By default, the canonicalized URL should represent the same resource and
   * typically de-reference to the same document (or a subpage of it).
   *
   * Canonicalization can be made a bit stronger through options, in particular
   * to canonicalize dated W3C URLs to the Latest version, and to use a list of
   * equivalent URLs (that the crawler typically generates).
   */
  function canonicalizeUrl(url, options) {
      options = options || {};

      let canon = url.replace(/^http:/, 'https:')
              .split('#')[0]
              .replace('index.html', '')
              .replace('Overview.html', '')
              .replace('cover.html', '')
              .replace(/spec.whatwg.org\/.*/, 'spec.whatwg.org/')  // subpage to main document in whatwg
              .replace(/w3.org\/TR\/(([^\/]+\/)+)[^\/]+\.[^\/]+$/, 'w3.org/TR/$1') // subpage to main document in w3c
              .replace(/w3.org\/TR\/([^\/]+)$/, 'w3.org/TR/$1/') // enforce trailing slash
              .replace(/w3c.github.io\/([^\/]+)$/, 'w3c.github.io/$1/') // enforce trailing slash for ED on GitHub
          ;

      if (options.datedToLatest) {
          canon = canon.replace(
              /w3.org\/TR\/[0-9]{4}\/[A-Z]+-(.*)-[0-9]{8}\/?/,
              'w3.org/TR/$1/');
      }

      let equivalentUrls = (options.equivalents) ? options.equivalents[canon] : null;
      if (Array.isArray(equivalentUrls)) {
          return (options.returnAlternatives ? equivalentUrls : equivalentUrls[0]);
      }
      else {
          return (equivalentUrls ? equivalentUrls : canon);
      }
  }


  function canonicalizesTo(url, refUrl, options) {
      let newOptions = {
          datedToLatest: (options ? options.datedToLatest : false),
          equivalents: (options ? options.equivalents : null),
          returnAlternatives: true
      };
      let canon = canonicalizeUrl(url, newOptions);
      return Array.isArray(refUrl) ?
          refUrl.some(u => canon.includes(u)) :
          canon.includes(refUrl);
  }

  /**
   * Extract and canonicalize absolute links of the document
   * FIXME: ⚠ Modify the DOM
  */
  function extractLinks () {
    // Ignore links from the "head" section, which either link to
    // self, the GitHub repo, the implementation report, and other
    // documents that don't need to appear in the list of references.
    [...document.querySelectorAll('.head a[href]')].forEach(n => n.href = '');
    const links = new Set([...document.querySelectorAll('a[href^=http]')]
      .map(n => canonicalizeUrl(n.href)));
    return [...links];
  }

  // Mapping from specDomNodeId to DOM node.

  // Get the next DOM node in the preorder traversal.
  function nextNode(node) {
    if (node.firstChild) {
      return node.firstChild;
    }
    while (!node.nextSibling) {
      node = node.parentNode;
      if (!node) {
        return null;
      }
    }
    return node.nextSibling;
  }

  // Internally, we assign integer IDs to each DOM node, and represent
  // positions of text segments using pairs of integers
  // [specDomNodeId, textPositionWithinNode].
  function assignIDs(node, id) {
    while (node) {
      node.specDomNodeId = id;
      id += 1;
      node = nextNode(node);
    }
  }

  //==============+==============+==============+==============+==============+==============+

  // getRaw* functions returns a list (type SpecStepList) with elements either:
  // - {text: string, text_map: list of SpecTextMapEntryData},
  // - {steps: SpecStepList, stepNameStyle: string}, or
  // - SpecStepList.
  // See also `SpecTextMapEntryData` in lib/base.py.

  // TODO: Add JSDoc.

  // TODO: refactor by assigning types explicitly. Currently type names are
  // only in comments for explanation.

  // Returns SpecStepList.
  // Unlike getRawSteps(), this function only considers textContent and ignores
  // any DOM structures.
  function getRawStepsOfText(node) {
    if (node.nodeType === node.TEXT_NODE) {
      // Take textContent and remove newlines.
      const text = node.textContent.replace(/\n/g,' ');

      const text_map = [];
      let pos = 0;
      let m;
      // Split the text into words.
      while (m = text.substring(pos).match(/[^\s]+/)) {
        if (m.index > 0) {
          text_map.push({text: ' '});
        }
        const word = m[0];
        pos += m.index;
        text_map.push({text: word,
                       specDomNodeId: node.specDomNodeId,
                       startTextPosition: pos});
        pos += word.length;
      }
      if (pos < text.length) {
        text_map.push({text: ' '});
      }

      return [{text: text, text_map: text_map}];
    }

    let stepList = [];
    let c;
    for(c = node.firstChild; c; c = c.nextSibling) {
      stepList = stepList.concat(getRawStepsOfText(c));
    }
    return stepList;
  }

  // Returns SpecStepList.
  function getRawSteps(node) {
    const window = node.ownerDocument.defaultView;
    const listStyleType = '';
        // window.getComputedStyle(node).getPropertyValue('list-style-type');
    let stepList = [];
    let c = node.firstChild;
    while (c) {
      if (c.nodeType === c.COMMENT_NODE) ; else if (c.nodeType === c.TEXT_NODE) {
        stepList = stepList.concat(getRawStepsOfText(c));
      } else if (c.localName === 'ol') {
        stepList.push(getRawSteps(c));
      } else if (c.localName === 'dl') {
        stepList.push(getRawSteps(c));
      } else if (c.localName === 'li' && c.matches('ol > li')) {
        stepList.push({steps: getRawSteps(c), stepNameStyle: listStyleType});
      } else if (c.localName === 'dt' && c.matches('dl > dt')) {
        // <dt>Case1</dt>
        // <dt>Case2</dt>
        // <dd>Do something.</dd>
        // => parsed to:
        //      Case1\n
        //      Case2\n
        //      Do something.
        let subStepList = [];
        while (c.localName === 'dt') {
          subStepList = subStepList.concat(getRawStepsOfText(c));
          subStepList.push({text: '\n', text_map: [{text: '\n'}]});
          c = c.nextSibling;
        }
        if (c.localName === 'dd') {
          stepList.push({steps: subStepList.concat(getRawSteps(c)),
                    stepNameStyle: "dd"});
        } else {
          console.error(c);
        }
      } else if (!c.matches(".note")) {
        const subStepList = getRawSteps(c);
        if (stepList.length > 0 && subStepList.length > 0 &&
            stepList[stepList.length - 1].text && subStepList[0].text) ;
        stepList = stepList.concat(subStepList);
      }
      c = c.nextSibling;
    }
    return stepList;
  }

  // Trims leading/trailing whitespace entries.
  function normalizeMap(text_map, baseDomNodeId) {
    while (text_map.length > 0 && text_map[0].text.trim() === '') {
      text_map.shift();
    }
    while (text_map.length > 0 &&
           text_map[text_map.length-1].text.trim() === '') {
      text_map.pop();
    }
    for (const e of text_map) {
      if (e.specDomNodeId !== undefined) {
        e.specDomNodeId -= baseDomNodeId;
      }
    }
    return text_map;
  }

  // Returns SpecStepList.
  function normalize(stepList, baseDomNodeId) {
    const normalizedStepList = [];
    let i = 0;
    while (true) {
      // Merge and normalize consecutive text entries.
      let text = '';
      let text_map = [];
      while (i < stepList.length && 'text' in stepList[i]) {
        text += stepList[i].text;
        text_map = text_map.concat(stepList[i].text_map);
        i += 1;
      }
      // Merge consecutive white spaces.
      text = text.replace(/ +/g, ' ').trim();
      if (text !== '') {
        normalizedStepList.push({text: text, text_map: normalizeMap(text_map, baseDomNodeId)});
      }

      if (i >= stepList.length) {
        break;
      }

      if('steps' in stepList[i]) {
        normalizedStepList.push({steps: normalize(stepList[i].steps, baseDomNodeId),
                  stepNameStyle: stepList[i].stepNameStyle});
      } else {
        normalizedStepList.push(normalize(stepList[i], baseDomNodeId));
      }
      i += 1;
    }

    return normalizedStepList;
  }

  function calculateStepName(stepNameStyle, stepNumber) {
    if (stepNameStyle === "dd" ||
        stepNameStyle === "upper-alpha" ||
        stepNameStyle === "upper-latin") {
      // Step A, B, C, ...
      // We currently use this notation for <dd>-style spec steps, e.g. for
      //   <dt>Case Foo</dt><dd>Do something Foo.</dd>
      //   <dt>Case Bar</dt><dd>Do something Bar.</dd>
      // we name these steps Step A and Step B, respectively, while the
      // letters "A" or "B" don't appear in the spec HTML.
      return String.fromCharCode("A".charCodeAt() + stepNumber - 1);
    } else if (stepNameStyle === "lower-alpha" ||
               stepNameStyle === "lower-latin") {
      // Step a, b, c, ...
      return String.fromCharCode("a".charCodeAt() + stepNumber - 1);
    } else if (stepNameStyle === "lower-roman") {
      // Step i, ii, iii, ...
      const lowerRomanNumbers = [
          "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
          "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"];
      return lowerRomanNumbers[stepNumber - 1];
    } else if (!stepNameStyle || stepNameStyle === "decimal") {
      // Step 1, 2, 3, ...
      return stepNumber;
    } else if (stepNameStyle === "none") {
      return stepNumber;
    } else {
      // TODO: Implement further stepNameStyle if not yet covered.
      return stepNumber;
    }
  }

  // Assigns step numbers to each step, and
  // returns a flat list of SpecStepData, i.e.
  // {step_name: string, text: string, text_map: list of SpecTextMapEntryData}.
  // See also `SpecStepData` in lib/base.py.
  function assignStepNumber(stepList, parentStepNumber) {
    let stepNumber = 1;
    let ret = [];
    for (const l of stepList) {
      if (l.steps) {
        const stepName = calculateStepName(l.stepNameStyle, stepNumber) + '.';
        ret = ret.concat(assignStepNumber(l.steps, parentStepNumber + stepName));
        ++stepNumber;
      } else if (l.text) {
        ret.push({step_name: parentStepNumber,
                  text: l.text,
                  text_map: l.text_map});
      } else {
        ret = ret.concat(assignStepNumber(l, parentStepNumber));
      }
    }
    return ret;
  }

  function isSpecStepList(node) {
    if (node.localName === 'ol') {
      // <ol>
      //   <li>Step 1. ...
      // </ol>
      return true;
    }

    if (node.localName === 'dl') {
      // Basically <dl> lists also describe a list of steps, but some specs
      // uses <dl> for defining input/output for algorithms, e.g.
      // <dl>
      //   <dt>Input</dt><dd>input</dd>
      //   <dt>Output</dt><dd>output</dd>
      // </dl>
      // <ol>
      //   <li>Step 1. ...
      // </ol>
      // https://w3c.github.io/ServiceWorker/#create-job-algorithm
      // so we exclude such <dl>s here.
      let inputOutputFound = false;
      for (const dt of node.querySelectorAll(':scope > dt')) {
        if (dt.textContent.trim() === 'Input' ||
            dt.textContent.trim() === 'Output') {
          inputOutputFound = true;
        } else {
          // if <dl> has <dt> other than Input/Output, then probably it
          // describes spec steps.
          return true;
        }
      }
      if (inputOutputFound) {
        // <dl> with only Input/Output <dt>s. Surely not spec steps.
        return false;
      }

      // <dl> with no <dt>s.
      return true;
    }

    return false;
  }

  function getNextSibling(e) {
    e = e.nextElementSibling;
    // Skip status elements.
    while (e && e.classList.contains('status')) {
      e = e.nextElementSibling;
    }
    return e;
  }

  function extractInternal(doc) {
  /*
    // FOXME: this caused misalignment in generated crossref.
    const nodesToRemove = [];
    for (const s of doc.querySelectorAll('.status, .note, .domintro')) {
      nodesToRemove.push(s);
    }
    for (const node of nodesToRemove) {
      node.parentNode.removeChild(node);
    }
  */

    const json = {};

    // Primary patterns with <dfn>.
    for (const dfn of doc.querySelectorAll('dfn[id]')) {
      let next = getNextSibling(dfn.parentNode);
      if (next && isSpecStepList(next)) {
        // <p> ... <dfn id="id"></dfn> ... </p>
        // <ol> or <dl> <- |next| points here
        //   <li> Step 1. ...
        // </ol>
        next.covered = true;
        json[dfn.id] = getRawSteps(next);
      } else if (dfn.parentNode.localName === 'dt' &&
               next && next.localName === 'dd') {
        // <dt> ... <dfn id="id"></dfn> ... </dt>
        // <dd> <- |next| points here
        //   ...
        // </dd>
        next.covered = true;
        json[dfn.id] = getRawSteps(next);
      } else if (dfn.parentNode.classList.contains('algorithm')) {
        // <div class="algorithm">
        //   Some texts ... <dfn id="id"></dfn> ...:
        //   <ol> or <dl>
        //     <li> Step 1. ...
        //   </ol>
        // </div>
        next = getNextSibling(dfn);
        while (next && !isSpecStepList(next)) {
          next = getNextSibling(next);
        }
        if (next) {
          next.covered = true;
          json[dfn.id] = getRawSteps(next);
        }
      } else if (dfn.parentNode.localName === 'p') {
        // A spec concept without steps.
        // <p> ... <dfn id="id"></dfn> ... </p>
        dfn.parentNode.covered = true;
        json[dfn.id] = getRawSteps(dfn.parentNode);
      }
    }

    // <emu-clause id="">
    //   <emu-alg>
    //     <ol>
    //       <li>Step 1. ...
    //     </ol>
    //   </emu-alg>
    // </emu-clause>
    // For ECMAScript spec.
    // TODO: multiple <emu-alg> elements can appear in a single <emu-clause>.
    for (const steps of doc.querySelectorAll('emu-clause[id] > emu-alg > ol')) {
      steps.covered = true;
      json[steps.parentNode.parentNode.id] = getRawSteps(steps);
    }

    // Secondary patterns without <dfn>.
    // Only used unless covered by primary patterns. This is to avoid to
    // associate the following pattern in SW spec with multiple hashes:
    // <section class="algorithm">
    //   <h4 id="hash1">
    //   <p>...<dfn id="hash2"></dfn>...</p>
    //   <ol>...</ol>
    // </section>
    // The <ol> here is associated only with |hash2|.

    for (const dt of doc.querySelectorAll('dt[id]')) {
      const next = getNextSibling(dt);
      if (next.covered) {
        continue;
      }

      if (next && next.localName === 'dd') {
        // <dt id="">Case Foo</dt>
        // <dd>
        //   Do something.
        // </dd>
        // Parse this to "Case Foo\nDo something.".
        json[dt.id] = getRawSteps(dt).concat(getRawSteps(next));
      }
    }

    // <h4 id="hash">
    // <p>...</p> <- Currently we ignore this.
    // <p>...</p> <- Currently we ignore this.
    // <ol>...</ol> <- We extract this.
    // <h4 id="nexthash">
    for (const h of doc.querySelectorAll(
        'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) {
      const specSteps = [];
      let next = getNextSibling(h);
      while (next) {
        if (next.localName === 'h1' || next.localName === 'h2' ||
            next.localName === 'h3' || next.localName === 'h4' ||
            next.localName === 'h5' || next.localName === 'h6') {
          break;
        }
        if (isSpecStepList(next)) {
          specSteps.push(next);
        }
        next = getNextSibling(next);
      }

      if (specSteps.length === 1) {
        if (!specSteps[0].covered) {
          json[h.id] = getRawSteps(specSteps[0]);
        }
      }
    }

    // Second, we normalize SpecStepList (mainly normalizing whitespaces).
    for (const id in json) {
      try {
        const baseDomNodeId = doc.getElementById(id).specDomNodeId;
        json[id] = assignStepNumber(normalize(json[id], baseDomNodeId), '');
      } catch (e) {
        json[id] = ("ERROR: " + e.stack);
      }
    }

    return json;
  }

  function extractSteps () {
    assignIDs(document, 1);
    return extractInternal(document);
  }

  // Create a namespace to expose all Reffy functions if needed,
  // and expose all functions there.
  window.reffy = Object.assign(
    window.reffy || {},
    {
      getTitle,
      getGenerator,
      getLastModifiedDate,
      extractWebIdl,
      extractCSS,
      extractDefinitions,
      extractReferences,
      extractLinks,
      canonicalizeUrl,
      canonicalizesTo,
      extractSteps
    }
  );

}());
