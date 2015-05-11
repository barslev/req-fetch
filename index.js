'use strict';

var http = require('http');
var https = require('https');
var parseUrl = require('url').parse.bind(require('url'));

var debug = require('debug')('req-uest');
var fetch = require('node-fetch');
fetch.Promise = require('bluebird');

exports.forwardCookie = forwardCookie;
function forwardCookie(res, response, alterPath) {
    var cookies = response.headers.getAll('set-cookie');
    if (cookies.length) {
        cookies = cookies.map(function (cstr) {
            cstr = cstr.replace(/; *Domain=[^;]*(; *)?/i, '; ');
            if (alterPath === false) {
                return cstr;
            } else if ('function' == typeof alterPath) {
                return cstr.replace(/; *Path=(\/[^;]*)(; *)?/i, function (all, $1, $2) {
                    return '; Path=' + alterPath($1) + ($2 || '');
                });
            } else {
                return cstr.replace(/; *Path=\/[^;]*(; *)?/i, '; Path=/$1');
            }
        });
        var prev = res.get('Set-Cookie');
        if (prev) {
            if (Array.isArray(prev)) {
                cookies = prev.concat(cookies);
            } else {
                cookies = [prev].concat(cookies);
            }
        }
        res.set('Set-Cookie', cookies);
    }
}

exports.augmentReqProto = augmentReqProto;
function augmentReqProto(reqProto, options) {
    options = options || {};
    var prefix, end;
    if (options.prefix) {
        prefix = options.prefix;
        delete options.prefix;
    }
    options.augments = null != options.augments && ~['object', 'function'].indexOf(typeof options.augments)
        ? options.augments
        : {};
    var augments = [];
    if (Array.isArray(options.augments)) {
        augments = options.augments
    } else if ('function' == typeof options.augments) {
        augments = [options.augments];
    } else if ('object' == typeof options.augments) {
        if (options.augments.agent !== false) {
            augments.push(function(url, opts, req) {
                var parsedUrl = parseUrl(url);
                debug('using sharedAgents, protocol: ', parsedUrl.protocol);
                opts.agent = opts.sharedAgents[parsedUrl.protocol || 'http:'];
            });
        }
        if (options.augments.cookies !== false) {
            augments.push(function(url, opts, req) {
                var cookies;
                if (req.header && (cookies = req.header('cookie'))) {
                    opts.headers['Cookie'] = cookies;
                }
                debug('cookies: %j', cookies);
            });
        }
        if (options.augments.ips !== false) {
            augments.push(function(url, opts, req) {
                var ips = [];
                ips.push(req.ip);
                if (req.ips && Array.isArray(req.ips)) {
                    ips = ips.concat(req.ips[0] == req.ip ? req.ips.slice(1) : req.ips);
                }
                ips = ips.filter(function (ip) {
                    return ['127.0.0.1', '::', '::1'].indexOf(ip) === -1;
                });
                debug('ips: %j', ips);
                if (ips.length) opts.headers['X-Forwarded-For'] = ips.join(',');
            });
        }
        if ('function' == typeof options.augments.custom) {
            augments.push(options.augments.custom);
        }
        delete options.augments;
    }
    Object.defineProperty(reqProto, 'fetch', {
        get: function () {
            var req = this;
            var p = function (url) {
                debug('request url: %s', url);
                return url;
            };
            if (typeof prefix === 'string') {
                prefix = prefix.replace(/\/+$/, '');
                p = function (url) {
                    debug('augment url: %s', url);
                    if (url[0] == '/') {
                        url = prefix + url;
                    }
                    debug('request url: %s', url);
                    return url;
                };
            }
            function augment(r) {
                return r;
            }
            function _fetch(url, opts) {
                var f;
                opts = opts || {};
                opts.headers = opts.headers || {};
                if (opts.headers instanceof fetch.Headers) {
                    opts.headers = opts.headers.raw();
                }

                url = p(url);
                opts.sharedAgents = sharedAgents;
                augments.forEach(function (f) { f(url, opts, req); });
                if (typeof options.serializer === 'function' &&
                        typeof opts.body === 'object' &&
                        !opts.body.pipe) {
                    options.serializer(url, opts, req);
                }

                f = fetch(url, opts);

                debug('headers: %j', opts.headers);
                return f;
            }
            _fetch.forwardCookie = forwardCookie.bind(null, req.res);
            var sharedAgents = _fetch.sharedAgents = {
                'http:': new http.Agent({maxSockets: 2}),
                'https:': new https.Agent({maxSockets: 2})
            };
            Object.defineProperty(req, 'fetch', {value: _fetch});
            return _fetch;
        }
    });
}

exports.augmentApp = reqUest;
function reqUest(obj, options) {
  if (!obj.request) throw new Error('first argument should be express module or an express app object');
  return augmentReqProto(obj.request, options);
}
