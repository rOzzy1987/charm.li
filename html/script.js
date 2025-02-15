const allCollapsibleUls = document.querySelectorAll('ul ul');
let foldingStateChanged = false;

function isCollapsibleUl(elt) {
    return [].indexOf.call(allCollapsibleUls, elt) !== -1;
}

function findHashA() {
    const hash = location.hash.slice(1);
    if (hash.length === 0) {
	return null;
    }

    const nameFirefox = hash.split("/").map(decodeURIComponent).join("/");
    const nameChrome = hash;
    const eltsFF = document.getElementsByName(nameFirefox);
    const eltsChrome = document.getElementsByName(nameChrome);
    if (eltsFF.length > 0) {
	return eltsFF[0];
    } else if (eltsChrome.length > 0) {
	return eltsChrome[0];
    }
}

function toLi(elt) {
    while (elt.tagName !== 'LI') {
	elt = elt.parentElement;
    }
    return elt;
}

function aToUl(aElt) {
    return toLi(aElt).querySelector('ul');
}

function ulToA(ulElt) {
    return toLi(ulElt).querySelector('a');
}

function parentUl(ulElt) {
    let curElt = ulElt.parentElement;
    while (curElt !== document.body && !isCollapsibleUl(curElt)) {
	curElt = curElt.parentElement;
    }
    return isCollapsibleUl(curElt) && curElt;
}

function updateFolderIcon(ulElt) {
    const li = toLi(ulElt);
    if (isUlShown(ulElt)) {
	li.classList.add('li-folder-open');
    } else {
	li.classList.remove('li-folder-open');
    }
}

function hideUl(ulElt) {
    foldingStateChanged = true;
    ulElt.classList.add("hidden");
    updateFolderIcon(ulElt);
}

function showUl(ulElt) {
    foldingStateChanged = true;
    ulElt.classList.remove('hidden');
    updateFolderIcon(ulElt);
}

function toggleUl(ulElt) {
    foldingStateChanged = true;
    ulElt.classList.toggle('hidden');
    updateFolderIcon(ulElt);
}

function isUlShown(ulElt) {
    return !ulElt.classList.contains('hidden');
}

function linkClickedHandler(event) {
    toggleUl(aToUl(event.target));
}

function setupLink(ulElt) {
    const elt = ulToA(ulElt);
    if (elt.tagName === "A" && !elt.href) {
	elt.href = "javascript:void(0)";
	elt.addEventListener("click", linkClickedHandler);
    }
}

function hideAll() {
    [].forEach.call(allCollapsibleUls, hideUl);
}

function showAll() {
    [].forEach.call(allCollapsibleUls, showUl);
}

function checkCheckbox(el) {
    el.checked = true;
}

function normalizedPath() {
    const hasTrailingSlash = location.pathname.slice(-1) === '/';
    return location.pathname.slice(baseUrl.length) + (hasTrailingSlash ? '' : '/');
}

function isFoldablePage() {
    // config:
    const numCarPathParts = 3;
    const maxUnfoldedLis = 20;

    return normalizedPath().slice(0, -1).split('/').length > numCarPathParts
	&& document.getElementsByTagName('li').length > maxUnfoldedLis;
}

function saveState() {
    const foldingState = foldingStateChanged

	  ? [].map.call(allCollapsibleUls, isUlShown)
	  .map(c => c ? '1' : '0')
	  .join('')

	  : null;

    const state = {
	lastHash: location.hash,
	folding: foldingState,
	scrollY: window.scrollY,
    };
    sessionStorage.setItem(normalizedPath(), JSON.stringify(state));
}

function restoreState() {
    const stateStr = sessionStorage.getItem(normalizedPath());
    if (stateStr) {
	const state = JSON.parse(stateStr);
	if (state.folding) {
	    state.folding.split('').forEach((ch, i) => {
		if (ch === '1') {
		    showUl(allCollapsibleUls[i]);
		}  else if (ch === '0') {
		    hideUl(allCollapsibleUls[i]);
		} else {
		    console.error('Illegal state');
		    sessionStorage.removeItem(normalizedPath());
		}
	    });
	}
	state.alreadySeenHash = location.hash === state.lastHash;
	if (state.alreadySeenHash) {
	    window.scroll(window.scrollX, state.scrollY);
	}
	return state;
    }
    return false;
}

function main() {
    if (!isFoldablePage()) {
	if (document.getElementById('expand-all')) {
	    document.getElementById('expand-all').classList.add('hidden');
	    document.getElementById('collapse-all').classList.add('hidden');
	}
	[].forEach.call(allCollapsibleUls, elt => toLi(elt).classList.add('li-folder-open'));
	return;
    }

    [].forEach.call(allCollapsibleUls, setupLink);
    window.addEventListener('beforeunload', saveState);
    if (document.getElementById("expand-all")) {
	document.getElementById("expand-all").addEventListener("click", showAll);
	document.getElementById("collapse-all").addEventListener("click", hideAll);
    }

    const restoredState = restoreState();
    if (!(restoredState && restoredState.folding)) {
	hideAll();
    }

    const hashA = findHashA();
    if (hashA) {
	const hashUl = aToUl(hashA);
	let hashUlParent = hashUl;
	while (hashUlParent) {
	    showUl(hashUlParent);
	    hashUlParent = parentUl(hashUlParent);
	}
	toLi(hashA).classList.add("selected");
	if (!restoredState.alreadySeenHash) {
	    hashA.scrollIntoView();
	    window.scrollY -= 50;
	}
    }

    foldingStateChanged = false;
}

main();
