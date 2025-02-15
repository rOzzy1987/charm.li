const fs = require('fs');
const assert = require('assert');
const express = require('express');
const lmdb = require('node-lmdb');
const entities = require('html-entities');
const mustache = require('mustache');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
const router = express.Router();
const pagesEnv = new lmdb.Env();
const imagesEnv = new lmdb.Env();

const production = process.env.NODE_ENV === 'production';

if (process.argv.length-2 !== 2) {
    console.log('Usage: npm start -- baseUrl port');
    process.exit(1);
}

const [baseUrl, port] = process.argv.slice(2);
console.log(`Preparing to start server at ${baseUrl} on port ${port}`);
assert(baseUrl[0] === '/');
assert(baseUrl.slice(-1) === "/");
assert(encodeURI(decodeURI(baseUrl)) == baseUrl); 

mustache.escape = c => c; 
const header = fs.readFileSync('header.html', 'utf8');
const footer = fs.readFileSync('footer.html', 'utf8');
const afterBreadcrumbs = fs.readFileSync('after-breadcrumbs.html', 'utf8');
const fourOhFour = fs.readFileSync('404.html', 'utf8');
const fourOhFourHtml = mustache.render(fourOhFour, { baseUrl });

function openDb(env, path) {
    process.on('exit', () => env.close());
    env.open({
	path,
	mapSize: 2 * 1024**4,
	readOnly: true,
	unsafeNoLock: true,
    });
    const db = env.openDbi({ name: null });
    process.on('exit', () => db.close());
    return db;
}

const pagesDb = openDb(pagesEnv, 'lmdb-pages');
const imagesDb = openDb(imagesEnv, 'lmdb-images');


function dbGetStringBinary(txn, dbi, key) {
    return txn.getBinary(dbi, Buffer.from(key, 'utf-8'));
}

function dbGetStringString(txn, dbi, key) {
    const buf = dbGetStringBinary(txn, dbi, key);
    return buf ? buf.toString('utf-8') : null;
}

function trimTrailingSlash(path) {
    return path.length > 1 && path.slice(-1) === '/' ? path.slice(0,-1) : path;
}

const minLinkBaseParts = 4; 

if (production) {
    router.use((req, res, next) => {
	res.set('Cache-Control', 'max-age=86400'); 
	return next();
    });
}

router.use(express.static('html'));



router.use('/hyperlink/', (req, res, next) => {
    const txn = pagesEnv.beginTxn({ readOnly: true });
    const path = trimTrailingSlash(req.path);

    const pathParts = path.split('/');
    const hashParts = [];
    let offsetStr;
    while ((offsetStr = dbGetStringString(txn, pagesDb, pathParts.join('/') + '/')) === null
	   && pathParts.length > minLinkBaseParts) {

	hashParts.unshift(pathParts.pop());
    }

    if (pathParts.length < minLinkBaseParts || offsetStr === null) {
	throw404();
    }
    
    let redirectUrl = baseUrl.slice(0, -1) + pathParts.join('/') + '/';
    if (hashParts.length > 0) {
	redirectUrl += '#' + hashParts.join('/') + '/';
    }
    res.redirect(redirectUrl);
});


router.use((req, res, next) => {
    
    if (req.originalUrl.slice(-1) !== '/') {
	let redirectUrl = req.originalUrl;
	const questionIndex = redirectUrl.lastIndexOf('?');
	if (questionIndex !== -1) {
	    redirectUrl = redirectUrl.slice(0, questionIndex);
	}
	
	if (redirectUrl.slice(-1) !== '/') {
	    redirectUrl += '/';
	}
	return res.redirect(redirectUrl);
    }

    return next();
});

router.use('/images/', (req, res, next) => {
    const txn = imagesEnv.beginTxn({ readOnly: true });
    const path = req.path;
    const buf = dbGetStringBinary(txn, imagesDb, path);
    if (buf === null) {
	return next();
    }

    
    if (isPng(buf)) {
	res.type('image/png');
    } else if (isJpeg(buf)) {
	res.type('image/jpeg');
    } else if (isGif(buf)) {
	res.type('image/gif');
    } else {
	console.log(`Image at "${path}" is in db but is not png nor jpeg nor gif.`);
	res.sendStatus(500);
    }

    res.send(buf);
});

router.use((req, res, next) => {
    const txn = pagesEnv.beginTxn({ readOnly: true });

    const path = req.path;
    const offsetStr = dbGetStringString(txn, pagesDb, path);
    if (offsetStr === null) {
	throw404();
    }
    
    
    
    

    const articleHtml = dbGetStringString(txn, pagesDb, offsetStr);
    if (articleHtml === null) {
	console.log(`Could not find offset "${offsetStr}" even though it was the value for "${path}"`);
	return res.sendStatus(500);
    }

    const pathParts = path.split('/').filter(c => c.length>0);
    const title = breadcrumbsToDisplayTitle(pathParts);
    const h1Html = `<h1>${title}</h1>`;
    const breadcrumbsHtml = breadcrumbsToHtml(pathParts, txn, pagesDb);

    const mustacheParams = {
	seoTitle: breadcrumbsToSeoTitle(pathParts),
	seoDescription: breadcrumbsToSeoDescription(pathParts),
	baseUrl,
    };
    const headerHtml = mustache.render(header, mustacheParams);
    const afterBreadcrumbsHtml = mustache.render(afterBreadcrumbs, mustacheParams);
    const footerHtml = mustache.render(footer, mustacheParams);

    res.send(headerHtml + breadcrumbsHtml + afterBreadcrumbsHtml + h1Html + articleHtml + footerHtml);
});


router.use((err, req, res, next) => {
    if (res.headersSent) {
	return next();
    }

    if (err.status === 404) {
	return res.send(fourOhFourHtml);
    }

    if (err.status === 500) {
	res.send('Operation CHARM: Fatal Error, code 500! This should never happen, so please do send us an email to operation-charm [[at]] tuta.io so we may look into it.');
    } else {
	res.send(`Operation CHARM Fatal Error! Code ${res.statusCode}. Please send us an email to operation-charm [[at]] tuta.io so we can resolve the problem.`);
    }
    console.error(err);
});

app.use(baseUrl, router);
app.listen(port, '127.0.0.1');
console.log("Server running.");









function breadcrumbsToHtml(pathParts, txn, db) {
    let bcsSoFar = []; 
    let concreteBcsSoFar = []; 
    const bcHtmlsSoFar = [ breadcrumbsPartToHtml(baseUrl, 'Home') ];
    pathParts.forEach(part => {
	bcsSoFar.push(part);
	const hrefIfConcrete = breadcrumbsToHref(bcsSoFar, []);
	const hrefIfNotConcrete = breadcrumbsToHref(concreteBcsSoFar, bcsSoFar.slice(concreteBcsSoFar.length));
	const htmlPartName = entities.encode(decodeURIComponent(part));

	let href;
	if (dbGetStringString(txn, db, hrefIfConcrete) !== null) {
	    href = baseUrl + hrefIfConcrete.slice(1);
	    concreteBcsSoFar = Array.from(bcsSoFar);
	} else {
	    href = baseUrl + hrefIfNotConcrete.slice(1);
	}

	bcHtmlsSoFar.push(breadcrumbsPartToHtml(href, htmlPartName));
    });
    return '<div class=breadcrumbs>' + bcHtmlsSoFar.join(' <b>&gt;&gt;</b> ') + '</div>';
}

function breadcrumbsPartToHtml(href, htmlPartName) {
    return `<a class='breadcrumb-part' href='${href}'>${htmlPartName}</a>`;
}

function breadcrumbsToHref(concreteBcs, hashBcs) {
    const concretePart = '/' + concreteBcs.join('/') + '/';
    const hashPart = hashBcs.length > 0 ? '#' + hashBcs.join('/') + '/' : '';
    return concretePart + hashPart;
}

function arrEnd(arr) {
    return arr.slice(-1)[0];
}


function breadcrumbsToDisplayTitle(bcs) {
    if (bcs.length === 0) {
	return 'Home: All Service Manuals';
    }

    let result = decodeURIComponent(arrEnd(bcs));
    while (isProperty(bcs)) {
	bcs = bcs.slice(0, -1);
	result = decodeURIComponent(arrEnd(bcs)) + ': ' + result;
    }
    return result;
}


function breadcrumbsToSeoTitle(bcs) {
    switch (bcs.length) {
    case 0:
	return "Free Car Service Manuals from Operation CHARM — No strings attached!";
    case 1:
    case 2:
	return `Free Service Manuals for ${breadcrumbsToSeoCar(bcs)} vehicles | Operation CHARM`;
    case 3:
	return `Free Service Manual for the ${breadcrumbsToSeoCar(bcs)} | Operation CHARM`;
    default:
	
	
	
	return `${breadcrumbsToDisplayTitle(bcs)} — ${breadcrumbsToSeoCar(bcs)} Service Manual | Operation CHARM`;
    }

}

function breadcrumbsToSeoDescription(bcs) {
    switch (bcs.length) {
    case 0:
	return "Operation CHARM provides completely free repair/service/workshop manuals for over 50,000 models of cars and trucks manufactured 1982-2013. No sign-up or paywall.";
    case 1:
    case 2:
	return `Detailed repair/service/workshop manuals for almost all ${breadcrumbsToSeoCar(bcs)} vehicles, including electrical diagrams, recommended bolt torques, and estimated labor times.`;
    case 3:
	return `Detailed repair manual for the ${breadcrumbsToSeoCar(bcs)}, including electrical diagrams, recommended bolt torques, and estimated labor times.`;
    default:
	return `Detailed repair manual for the ${breadcrumbsToSeoCar(bcs)}.`;
    }
}

function breadcrumbsToSeoCar(bcs) {
    switch (bcs.length) {
    case 0:
	throw "Can't calculate SEO-optimized car name of empty breadcrumbs.";
    case 1:
	return decodeURIComponent(bcs[0]);
    case 2:
	return `${decodeURIComponent(bcs[1])} ${decodeURIComponent(bcs[0])}`;
    default:
	return `${decodeURIComponent(bcs[1])} ${decodeURIComponent(bcs[0])} ${decodeURIComponent(bcs[2])}`;
    }
}


function isGif(buffer) {
	if (!buffer || buffer.length < 3) {
		return false;
	}

	return buffer[0] === 0x47
		&& buffer[1] === 0x49
		&& buffer[2] === 0x46;
}


function isPng(buffer) {
	if (!buffer || buffer.length < 8) {
		return false;
	}

	return buffer[0] === 0x89
		&& buffer[1] === 0x50
		&& buffer[2] === 0x4E
		&& buffer[3] === 0x47
		&& buffer[4] === 0x0D
		&& buffer[5] === 0x0A
		&& buffer[6] === 0x1A
		&& buffer[7] === 0x0A;
}


function isJpeg(buffer) {
	if (!buffer || buffer.length < 3) {
		return false;
	}

	return buffer[0] === 255
		&& buffer[1] === 216
		&& buffer[2] === 255;
}

function isProperty(bcs) {
    const title = decodeURIComponent(arrEnd(bcs));
    return [ 'service precautions'
	     , 'application and id'
	     , 'description and operation'
	     , 'adjustments'
	     , 'testing and inspection'
	     , 'diagrams'
	     , 'locations'
	     , 'specifications'
	     , 'service and repair'
	     , 'parts'
	     , 'technical service bulletins'
	     , 'tools and equipment'
	     , 'labor times'
	     , 'exploded diagram'
	     , 'service intervals'
	     , 'fundamentals and basics'
	     , 'diagnostic trouble codes'
	     , 'diagnosis and testing'
	     , 'overview'
	     , 'general procedures']
	.indexOf(title.toLowerCase()) !== -1
	|| ('' + Number(title)) === title 
	|| bcs.length === 3; 
}

function throw500(msg) {
    const err = new Error(msg);
    err.status = 500;
    throw err;
}

function throw404() {
    const err = new Error('Page not found');
    err.status = 404;
    throw err;
}
