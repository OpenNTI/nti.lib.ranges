import * as Anchors from 'nti-lib-anchorjs';
import * as DOM from 'nti-lib-dom';
import Logger from 'nti-util-logger';

const logger = Logger.get('lib:ranges');

const nonContextWorthySelectors = [
	'object:not([type*=nti])'
];

const customContextGathers = {
	'object[type$=naquestion]': gatherQuestionContext,
	'object[type$=ntivideo]': gatherVideoContext
};


export function isValidRange (r, containerNode = document) {
	let commonNode = r && r.commonAncestorContainer;
	let invalid = !r
		|| !containerNode.contains(commonNode)
		|| (
			r.collapsed &&
			r.startContainer === commonNode &&
			r.endContainer === commonNode &&
			r.startOffset === 0 &&
			r.endOffset === 0
		);
	return !invalid;
}


export function saveRange (r) {
	if (!r) {
		return null;
	}
	return {
		startContainer: r.startContainer,
		startOffset: r.startOffset,
		endContainer: r.endContainer,
		endOffset: r.endOffset,
		collapsed: r.collapsed
	};
}


export function saveInputSelection (s) {
	if (!s || !s.focusNode || !s.focusNode.firstChild || s.focusNode.firstChild.tagName !== 'INPUT') {
		return null;
	}
	let i = s.focusNode.firstChild;

	return {
		selectionStart: i.selectionStart,
		selectionEnd: i.selectionEnd,
		input: i
	};
}


export function restoreSavedRange (o) {
	if (!o) {
		return null;
	}
	let d, r;

	try {
		d = o.startContainer.ownerDocument;
		r = d.createRange();
		r.setStart(o.startContainer, o.startOffset);
		r.setEnd(o.endContainer, o.endOffset);
	}
	catch (e) {
		logger.error(e.message);
	}
	return r;
}


function nodeIfObjectOrInObject (node) {
	let selector = 'object';
	if (!node) {
		return null;
	}
	if (DOM.matches(node, selector)) {
		return node;
	}
	return DOM.parent(node, selector);
}

//tested
export function rangeIfItemPropSpan (range) {
	/*
	 * Special case for annototable images: We don't want to expand past the annototable img.
	 * And since we usually expand by a given number of characters,
	 * if you have multiple consecutive images, we were getting all of them; which is an unexpected behavior.
	 */
	let node = range.commonAncestorContainer, r, container,
		markupSelector = '[itemprop~=nti-data-markupenabled]';

	if (!node) {
		return null;
	}

	if (DOM.matches(node, markupSelector)) {
		container = node;
	}
	else {
		container = DOM.parent(node, markupSelector);
	}

	//If we are an annotatable image make sure we get the enclosing span so that it is
	//annotatable in the note window.
	if (container) {

		logger.debug('we\'re inside a itemprop span. %o', container);

		r = document.createRange();
		r.selectNode(container);
		return r;
	}
	return null;
}


function gatherQuestionContext (node) {
	let contents = node.querySelector('.naquestion');
	if (contents) {
		return contents.cloneNode(true);
	}
	return null;
}


function gatherVideoContext (node) {
	let title, src, titleNode, sourceNode;

	titleNode = node.querySelector('param[name=title]');
	if (titleNode) {
		title = titleNode.getAttribute('value');
	}

	sourceNode = node.querySelector('object[type$=videoSource]');
	if (sourceNode) {
		sourceNode = sourceNode.querySelector('param[name=thumbnail]');
		if (sourceNode) {
			src = sourceNode.getAttribute('value');
		}
	}

	return DOM.createDom({ cn: [
		{html: title},
		{
			tag: 'img',
			cls: 'video-thumbnail',
			src
		}
	]});
}


//How about a registry that maps the mimetype of the object
//to a handler that knows how to give contents
function contentsForObjectTag (object) {
	let node;

	for (let sel of Object.keys(customContextGathers)) {
		let fn = customContextGathers[sel];

		if (!node && DOM.matches(object, sel)) {
			node = fn(object);
			break;
		}
	}

	return node || object.cloneNode(true);
}


function nodeThatIsEdgeOfRange (range, start) {
	if (!range) {
		throw new Error('Node is not defined');
	}

	let container = start ? range.startContainer : range.endContainer,
		offset = start ? range.startOffset : range.endOffset,
		cont;

	//If the container is a textNode look no further, that node is the edge
	if (DOM.isTextNode(container)) {
		return container;
	}

	if (start) {
		//If we are at the front of the range
		//the first full node in the range is the containers ith child
		//where i is the offset
		cont = container.childNodes.item(offset);
		if (!cont) {
			return container;
		}
		if (DOM.isTextNode(cont) && cont.textContent.trim().length < 1) {
			return container;
		}
		return container.childNodes.item(offset);
	}

	//At the end the first fully contained node is
	//at offset-1
	if (offset < 1) {
		if (container.previousSibling) {
			return container.previousSibling;
		}
		while (!container.previousSibling && container.parentNode && offset !== 0) {
			container = container.parentNode;
		}

		if (!container.previousSibling) {
			//throw new Error('No possible node');
			return container;
		}
		return container.previousSibling;
	}
	return container.childNodes.item(offset - 1);
}


function coverAll (rangeA) {
	let range = rangeA ? rangeA.cloneRange() : null,
		start, end, newStart, newEnd;

	const test = (c) => DOM.isTextNode(c)
		|| Anchors.isNodeIgnored(c)
		|| /^(a|b|i|u|img|li)$/i.test(c.tagName);
		//	|| c.childNodes.length === 1;

	function walkOut (node, direction) {
		if (!node) {
			return null;
		}

		let doc = node.ownerDocument,
			walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ALL, null, null),
			nextName = direction === 'start' ? 'previousNode' : 'nextNode',
			temp, result;

		walker.currentNode = node;
		temp = walker.currentNode;
		result = temp;

		while (temp && test(temp)) {
			result = temp;
			temp = walker[nextName]();
		}

		//if we got here, we found nada:
		return result;
	}

	if (!range) {
		return null;
	}

	start = nodeThatIsEdgeOfRange(range, true);
	end = nodeThatIsEdgeOfRange(range);

	newStart = walkOut(start, 'start');
	if (newStart) {
		range.setStartBefore(newStart);
	}
	newEnd = walkOut(end, 'end');
	if (newEnd) {
		range.setEndAfter(newEnd);
	}

	return range;
}


export function expandRange (range, doc = range.commonAncestorContainer.ownerDocument) {
	let object = nodeIfObjectOrInObject(range.commonAncestorContainer) || nodeIfObjectOrInObject(range.startContainer);

	if (!object) {
		if (range.startContainer === range.endContainer &&
			range.startContainer.nodeType !== Node.TEXT_NODE &&
			range.startOffset + 1 === range.endOffset) {
			object = nodeIfObjectOrInObject(range.startContainer.childNodes[range.startOffset]);
		}
	}

	if (object) {
		return contentsForObjectTag(object);
	}

	let r = rangeIfItemPropSpan(range, doc);
	if (r) {
		return clearNonContextualGarbage(r.cloneContents());
	}

	r = coverAll(range);
	//Anchors.expandSelectionToIncludeMath(sel);
	return clearNonContextualGarbage(r.cloneContents());
}


function expandRangeGetNode (range, doc) {
	let tempDiv = doc.createElement('div');

	try {
		tempDiv.appendChild(expandRange(range));
	}
	catch (e) {
		logger.debug('Could not clone range contents %o', e.stack || e.message || e);
	}

	return tempDiv;
}

//tested
export function expandRangeGetString (range, doc) {
	let tempDiv, str;
	tempDiv = expandRangeGetNode(range, doc, true);
	str = tempDiv.innerHTML;

	//cleanup:
	DOM.removeNode(tempDiv);

	//return string clean of ids:
	return str.replace(/\wid=".*?"/ig, '');
}


/**
 * Removes any nodes we don't want to show up in the context, for now that is assessment objects nodes, which have
 * a size but no display, so it looks like a bunch of emopty space in the note window.
 *
 * @param {Element} dom - the dom you want cleaned, make sure it's a clone or you will delete stuff from the dom it belongs to.
 * @returns {Element} dom
 */
function clearNonContextualGarbage (dom) {
	for(let sel of nonContextWorthySelectors) {
		for(let node of dom.querySelectorAll(sel)) {
			DOM.removeNode(node);
		}
	}
	return dom;
}


/**
 * Takes a range or a rangy range and returns the bounding rect
 * @param {Range} r - either a browser range or a rangy range
 * @returns {ClientRect} Bounding Client Rect
 */
export function getBoundingClientRect (r) {
	if (r.nativeRange) {
		r = r.nativeRange;
	}

	return r.getBoundingClientRect();
}


export function getSelectedNodes (range, doc = range.commonAncestorContainer.ownerDocument) {
	let getAt = side => DOM.isTextNode(range[`${side}Container`]) ?
		range[`${side}Container`] :
		range[`${side}Container`].childNodes[range[`${side}Offset`]];

	let startAt = getAt('start'),
		endAt = getAt('end'),

		nodes = [],
		node;

	let walker = doc.createTreeWalker(
		range.commonAncestorContainer,
		NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, //eslint-disable-line no-bitwise
		//NOTE in every browser but IE the last two params are optional, but IE explodes if they aren't provided
		null, false);

	//NOTE IE also blows up if you call nextNode() on a newly initialized treewalker whose root is a text node.
	if (DOM.isTextNode(walker.currentNode)) {
		node = walker.currentNode;
	}
	else {
		node = walker.nextNode();
	}


	while (node) {

		if (node === endAt) {
			break;
		}

		else if (node === startAt || startAt === true) {
			if (!DOM.isTextNode(node)) {
				nodes.push(node);
			}
			startAt = true;
		}

		node = walker.nextNode();
	}

	// console.log('nodes from getSelectedNdoes', nodes);
	return nodes;
}



/**
 * ?
 * @param {Node} node ?
 * @returns {Node} node
 */
export function fixUpCopiedContext (node) {

	for (let n of node.querySelectorAll('[itemprop~=nti-data-markupenabled] a')) {
		DOM.addClass(n, 'skip-anchor');
	}

	for (let n of node.querySelectorAll('a[href]:not(.skip-anchor)')) {
		n.setAttribute('target', '_blank');
	}

	for (let n of node.querySelectorAll('a[href^=#]:not(.skip-anchor)')) {
		n.removeAttribute('href');
		n.removeAttribute('target');
	}

	for (let n of node.querySelectorAll('a[href^=tag]')) {
		n.removeAttribute('href');
		n.removeAttribute('target');
	}

	return node;
}
