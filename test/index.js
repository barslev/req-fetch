'use strict';

var http = require('http');

var tape = require('tape');
var reqFetch = require('../');
var unary = require('fn-unary');
var qs = require('qs');

var express = require('express');
var supertest = require('supertest');
var bodyParser = require('body-parser');

function getApp(options) {
    var backend = express();
    backend.set('trust proxy', true);
    backend.use(function (req, res, next) {
        res.type('text');
        next();
    });
    backend.get('/ok', function (req, res) {
        res.end('OK');
    });
    backend.get('/ips', function (req, res) {
        res.end(req.headers['x-forwarded-for']);
    });
    backend.get('/cookie', function (req, res) {
        res.end(req.headers.cookie);
    });
    backend.post('/urlencoded', bodyParser.urlencoded({extended: false}), function (req, res) {
        res.end(req.body.hello);
    });
    backend.post('/json', bodyParser.json(), function (req, res) {
        res.end(req.body.hello);
    });
    backend.get('/set-cookie', function (req, res) {
        res.cookie('hello', 'world', {path: '/helloworld', domain: 'example.com', maxAge: 60*60*1000});
        res.cookie('abc', '123', {path: '/abc123'});
        res.end('OK');
    });

    var app = express();
    app.backend = backend;
    app.backendServer = http.createServer(backend);
    var addr = app.backendServer.listen().address();
    app.enable('trust proxy');
    app.prefix = 'http://127.0.0.1:' + addr.port;
    options = options || {};
    if (typeof options.prefix === 'string') {
        options.prefix = options.prefix.replace('{prefix}', app.prefix);
    }
    reqFetch.augmentApp(app, options);
    return app;
}

function releaseApp(app) {
    app.backendServer.close();
}

function done(test, app) {
    return function (err) {
        test.ok(!err);
        releaseApp(app);
    };
}

tape('should cache req.fetch', function (test) {
    test.plan(4);
    var app = getApp();
    app.use('/test', function (req, res) {
        test.ok(!req.hasOwnProperty('fetch'));
        var uest1 = req.fetch;
        var uest2 = req.fetch;
        test.ok(req.hasOwnProperty('fetch'));
        test.strictEqual(uest1, uest2);
        res.statusCode = 204;
        res.end();
    });
    supertest(app)
        .get('/test')
        .expect(204)
        .end(done(test, app));
});

tape('sould work like fetch', function (test) {
    test.plan(4);
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/ok').then(function (response) {
            test.equal(response.status, 200);
            test.equal(response.statusText, 'OK');
            response.text().then(function (text) {
                test.equal(text, 'OK');
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204, done(test, app));
});

tape('sould work fine with post', function (test) {
    test.plan(4);
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/json', {
            method: 'post',
            headers: {
                'content-type': 'application/json;charset=UTF-8'
            },
            body: JSON.stringify({hello: 'world'})
        }).then(function (response) {
            test.equal(response.status, 200);
            test.equal(response.statusText, 'OK');
            response.text().then(function (text) {
                test.equal(text, 'world');
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204, done(test, app));
});

tape('prefix sould work fine when it\'s ending with slash', function (test) {
    test.plan(4);
    var app = getApp({prefix: '{prefix}/'});
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/json', {
            method: 'post',
            headers: {
                'content-type': 'application/json;charset=UTF-8'
            },
            body: JSON.stringify({hello: 'world'})
        }).then(function (response) {
            test.equal(response.status, 200);
            test.equal(response.statusText, 'OK');
            response.text().then(function (text) {
                test.equal(text, 'world');
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204, done(test, app));
});

tape('serializer should works', function (test) {
    test.plan(4);
    var app = getApp({serializer: function (url, opts, req) {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        opts.body = qs.stringify(opts.body);
    }});
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/urlencoded', {
            method: 'post',
            body: {hello: 'world'}
        }).then(function (response) {
            test.equal(response.status, 200);
            test.equal(response.statusText, 'OK');
            response.text().then(function (text) {
                test.equal(text, 'world');
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204, done(test, app));
});

tape('sould have header x-forwarded-for, and not record local ip', function (test) {
    test.plan(5);
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/ips').then(function (response) {
            test.equal(response.status, 200);
            test.equal(response.statusText, 'OK');
            response.text().then(function (text) {
                test.ok(text.indexOf('123.123.123.123') > -1);
                test.ok(text.indexOf('127.0.0.1') === -1);
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .set('X-Forwarded-For', '127.0.0.1,123.123.123.123,135.135.135.135')
        .expect(204, done(test, app));
});

tape('support disable ips augments', function (test) {
    test.plan(3);
    var app = getApp({augments: {ips: false}});
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/ips').then(function (response) {
            test.equal(response.status, 200);
            response.text().then(function (text) {
                test.equal(text.indexOf('123.123.123.123'), -1);
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .set('X-Forwarded-For', '123.123.123.123,135.135.135.135')
        .expect(204, done(test, app));
});

tape('sould proxy cookie', function (test) {
    test.plan(3)
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/cookie').then(function (response) {
            test.equal(response.status, 200);
            response.text().then(function (text) {
                test.equal('hello=world', text);
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .set('cookie', 'hello=world')
        .set('X-Forwarded-For', '123.123.123.123,135.135.135.135')
        .expect(204, done(test, app));
});

tape('support custom augments', function (test) {
    test.plan(3);
    var app = getApp({augments: {ips: false, custom: function (url, opts, req) { opts.headers['X-Forwarded-For'] = '234.234.234.234'; }}});
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/ips').then(function (response) {
            test.equal(response.status, 200);
            response.text().then(function (text) {
                test.ok(text.indexOf('234.234.234.234') > -1);
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .set('X-Forwarded-For', '123.123.123.123,135.135.135.135')
        .expect(204, done(test, app));
});

tape('forward cookie (alter path to / by default)', function (test) {
    test.plan(5);
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/set-cookie').then(function (response) {
            test.equal(response.headers.getAll('set-cookie').length, 2);
            res.cookie('a', 'b');
            req.fetch.forwardCookie(response);
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204)
        .end(function (err, r) {
            var cookies = r.headers['set-cookie'];
            //cookies before forwardCookie() should be kept.
            test.ok(cookies[0].indexOf('a=b') > -1);
            //domain in forward cookies should be cleared.
            test.ok(cookies.every(function (cookie) { return !cookie.match(/; *Domain=/); }));
            //path sould be alter to / by default.
            test.ok(cookies.every(function (cookie) { return cookie.match(/Path=\/(;|$)/); }));
            done(test, app)();
        });
});

tape('forward cookie (turn off path alter)', function (test) {
    test.plan(4);
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/set-cookie').then(function (response) {
            test.equal(response.headers.getAll('set-cookie').length, 2);
            req.fetch.forwardCookie(response, false);
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204)
        .end(function (err, r) {
            var cookies = r.headers['set-cookie'];
            test.ok(cookies[0].indexOf('Path=/helloworld') > -1);
            test.ok(cookies[1].indexOf('Path=/abc123') > -1);
            done(test, app)();
        });
});

tape('forward cookie (turn off path alter)', function (test) {
    test.plan(4);
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch(app.prefix + '/set-cookie').then(function (response) {
            test.equal(response.headers.getAll('set-cookie').length, 2);
            req.fetch.forwardCookie(response, function (url) {
                if (url == '/abc123') return '/abc456';
                else return url;
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204)
        .end(function (err, r) {
            var cookies = r.headers['set-cookie'];
            test.ok(cookies[0].indexOf('Path=/helloworld') > -1);
            test.ok(cookies[1].indexOf('Path=/abc456') > -1);
            done(test, app)();
        });
});

tape('support https', function (test) {
    test.plan(3)
    var app = getApp();
    app.use('/test', function (req, res) {
        req.fetch('https://example.com/').then(function (response) {
            test.equal(response.status, 200);
            response.text().then(function (text) {
                test.ok(text.indexOf('Example') > -1);
            });
            res.statusCode = 204;
            res.end();
        });
    });
    supertest(app)
        .get('/test')
        .expect(204, done(test, app));
});
