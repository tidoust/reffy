// Mapping from specDomNodeId to DOM node.
const mapFromSpecDomNodeId = {};

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
    mapFromSpecDomNodeId[id] = node;
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
    if (c.nodeType === c.COMMENT_NODE) {
      // Ignore comment nodes.
    } else if (c.nodeType === c.TEXT_NODE) {
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
          stepList[stepList.length - 1].text && subStepList[0].text) {
        const display = ''; // getComputedStyle(c).getPropertyValue('display');
        if (display === 'list-item') {
          // Put a separator.
          stepList.push({text: '\n', text_map: [{text: '\n'}]});
        }
      }
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

function getNextElementSibling(e) {
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
    let next = getNextElementSibling(dfn.parentNode);
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
      next = getNextElementSibling(dfn);
      while (next && !isSpecStepList(next)) {
        next = getNextElementSibling(next);
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
    const next = getNextElementSibling(dt);
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
    let next = getNextElementSibling(h);
    while (next) {
      if (next.localName === 'h1' || next.localName === 'h2' ||
          next.localName === 'h3' || next.localName === 'h4' ||
          next.localName === 'h5' || next.localName === 'h6') {
        break;
      }
      if (isSpecStepList(next)) {
        specSteps.push(next);
      }
      next = getNextElementSibling(next);
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

export default function () {
  assignIDs(document, 1);
  return extractInternal(document);
}
