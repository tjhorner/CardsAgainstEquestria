var log = require('logule').init(module);
var _ = require('underscore');

var Decks = require('../../lib/decks');

var https = require('https');
var fs = require('fs');

var config = null;

var probeDeck = function (req, res) {
    res.type('application/json');

    var code = req.body.code;
    if (!code || code.length != 5) {
        res.send(400);
        return;
    }

    log.debug('Probing CardCast deck ' + code);

    var options = {
        host: config.cardcast.host,
        port: config.cardcast.port,
        method: 'GET',
        path: _.template(config.cardcast.deckInfo)({deck: code})
    };

    var probeReq = https.request(options, function (probeRes) {
        log.debug('Probed CardCast deck: ' + probeRes.statusCode);
        if (probeRes.statusCode != 200) {
            res.send(JSON.stringify({response: {id: 'not_found', message: 'Deck not found'}}));
            return;
        }

        probeRes.setEncoding('utf-8');
        probeRes.on('data', function (chunk) {
            log.debug('Deck metadata successfully probed');
            res.send(JSON.stringify({response: JSON.parse(chunk)}));
        });
    });

    probeReq.on('error', function (err) {
        log.warn('Failed to probe CardCast deck (options: ' + JSON.stringify(options) + '): ' + err.message);
        res.send(500);
    });

    probeReq.end();
};

var importDeck = function (req, res) {
    var code = req.body.code;
    if (!code || code.length != 5) {
        res.send(400);
        return;
    }

    log.debug('Importing CardCast deck ' + code);

    var options = {
        host: config.cardcast.host,
        port: config.cardcast.port,
        method: 'GET',
        path: _.template(config.cardcast.deckInfo)({deck: code})
    };

    var probeReq = https.request(options, function (probeRes) {
        log.debug('Probed CardCast deck: ' + probeRes.statusCode);
        if (probeRes.statusCode != 200) {
            res.send(JSON.stringify({response: {id: 'not_found', message: 'Deck not found'}}));
            return;
        }

        probeRes.setEncoding('utf-8');
        var data = '';
        probeRes.on('data', function (chunk) {
            data += chunk;
        });
        probeRes.on('end', function () {
            log.debug('Deck metadata successfully downloaded');

            var meta = JSON.parse(data);

            var options = {
                host: config.cardcast.host,
                port: config.cardcast.port,
                method: 'GET',
                path: _.template(config.cardcast.deckCards)({deck: code})
            };

            var importReq = https.request(options, function (importRes) {
                log.debug('Importing CardCast deck: ' + importRes.statusCode);
                if (importRes.statusCode != 200) {
                    res.send(500);
                    return;
                }

                importRes.setEncoding('utf-8');
                var data = '';
                importRes.on('data', function (chunk) {
                    data += chunk;
                });
                importRes.on('end', function () {
                    log.trace('Deck successfully downloaded');

                    var cards = null;
                    try {
                        cards = JSON.parse(data);
                    } catch (err) {
                        log.warn('Failed to parse JSON: ' + err.message);
                        res.send(500);
                        return;
                    }

                    meta.black_cards = cards.calls;
                    meta.white_cards = cards.responses;
                    meta.cache_updated_at = new Date();

                    fs.writeFile(config.files.cache + '/' + code + '.json', JSON.stringify(meta), function (err) {
                        if (err) {
                            log.warn('Failed to save deck ' + code + ': ' + err.message);
                        } else {
                            log.info('Successfully saved deck ' + code);

                            Decks.load(code, function (err, deck) {
                                if (err) {
                                    log.warn('Failed to load deck: ' + err.message);
                                    res.send(500);
                                    return;
                                }

                                res.send(200);
                            });
                        }
                    });
                });
            });

            importReq.on('error', function (err) {
                log.info('Failed to import CardCast deck (options: ' + JSON.stringify(options) + '): ' + err.message);
                res.send(500);
            });

            importReq.end();
        });
    });

    probeReq.on('error', function (err) {
        log.warn('Failed to probe CardCast deck (options: ' + JSON.stringify(options) + '): ' + err.message);
        res.send(500);
    });

    probeReq.end();
};

var unloadDeck = function (req, res) {
    var code = req.body.code;
    if (!code || code.length != Decks.CODE_LENGTH) {
        res.send(400);
        return;
    }

    var deck = Decks.find(code);
    if (!deck) {
        res.send(404);
        return;
    }

    Decks.evict(deck);

    res.send(200);
};

var loadDeck = function (req, res) {
    var code = req.body.code;
    if (!code || code.length != Decks.CODE_LENGTH) {
        res.send(400);
        return;
    }

    Decks.load(code, function (err, deck) {
        if (err) {
            res.send(500);
            return;
        }

        res.send(200);
    });
};

var listCached = function (req, res) {
    var decks = _.map(Decks.listCached(), function (code) {
        var deck = Decks.find(code);
        if (deck) {
            var json = deck.toJSON();
            json.loaded = true;
            return json;
        } else {
            return {code: code, loaded: false};
        }
    });

    res.type('application/json');
    res.send(JSON.stringify(decks));
};

var listFeatured = function (req, res) {
    var decks = _.map(Decks.listFeatured(), function (deck) {
        return deck.toJSON();
    });

    res.type('application/json');
    res.send(JSON.stringify(decks));
};

var listLoaded = function (req, res) {
    var decks = _.map(Decks.listLoaded(), function (code) {
        return Decks.find(code).toJSON();
    });

    res.type('application/json');
    res.send(JSON.stringify(decks));
};

var listNotLoaded = function (req, res) {
    var decks = _.map(Decks.listNotLoaded(), function (code) {
        return Decks.find(code).toJSON();
    });

    res.type('application/json');
    res.send(JSON.stringify(decks));
};

module.exports = function (app, appConfig) {
    config = appConfig;

    app.post('/ajax/admin/cardcast/probe', probeDeck);
    app.post('/ajax/admin/cardcast/import', importDeck);

    app.post('/ajax/admin/cardcast/unload', unloadDeck);
    app.post('/ajax/admin/cardcast/load', loadDeck);

    app.get('/ajax/admin/cardcast/decks/cached', listCached);
    app.get('/ajax/admin/cardcast/decks/featured', listFeatured);
    app.get('/ajax/admin/cardcast/decks/loaded', listLoaded);
    app.get('/ajax/admin/cardcast/decks/unloaded', listNotLoaded);
};
