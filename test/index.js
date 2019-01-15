/* global describe, it, before */
import assert from 'assert';
import https from 'https';
import domain from 'domain';

import openport from 'openport';
import request from 'request';
import express from 'express';
import bodyParser from 'body-parser';

import HTTP from '../src';
import * as SSLKeys from './sslkeys';

describe('HTTP Transport', function () {
  let transport;
  let port;
  let host = '127.0.0.1';

  before(function (done) {
    openport.find(function (err, _port) {
      assert.ifError(err);
      port = _port;
      done();
    });
  });

  describe('Transport', function () {
    it('should create transport instance', function () {
      transport = new HTTP({ port: port, host: host });
      assert.strictEqual(transport instanceof HTTP, true);
    });

    it('should throw if required arguments are not passed in', function () {
      assert.throws(function () {
        let transport = new HTTP(); //eslint-disable-line
      });

      assert.throws(function () {
        let transport = new HTTP({ //eslint-disable-line
          host: '0.0.0.0'
        });
      });

      assert.throws(function () {
        let transport = new HTTP({ //eslint-disable-line
          port: 80
        });
      });
    });

    it('should set defaults correctly', function () {
      let transport = new HTTP({
        port: port,
        host: host
      });

      assert.strictEqual(transport.config.ssl, false);
      assert.strictEqual(transport.config.path, '/ht');

      transport = new HTTP({
        port: port,
        host: host,
        ssl: true,
        path: '/other'
      });

      assert.strictEqual(transport.config.ssl, true);
      assert.strictEqual(transport.config.path, '/other');
    });

    it('should not require new keyword for creation', function () {
      let transport = HTTP({ port: port, host: host });

      assert.strictEqual(transport instanceof HTTP, true);
    });

    it('should not rquire host & port when app is passed in', function () {
      let app = express();

      let transport = HTTP({ app: app });

      assert.strictEqual(transport instanceof HTTP, true);
    });
  });

  describe('Server', function () {
    let server;

    it('should have created server', function () {
      server = new transport.Server();
      assert.strictEqual(server instanceof transport.Server, true);
    });

    it('should start server when listen is called', function (done) {
      server.listen(function (err) {
        assert.ifError(err);

        assert.strictEqual(server.listening, true);

        done();
      });
    });

    it('should not try and start another server if listen is called again', function (done) {
      server.listen(function (err) {
        assert.ifError(err);
        done();
      });
    });

    it('should stop server when stop is called', function (done) {
      server.stop(function (err) {
        assert.ifError(err);

        assert.strictEqual(server.listening, false);

        done();
      });
    });

    it('should still call callback if server is not listening', function (done) {
      server.stop(function (err) {
        assert.ifError(err);

        done();
      });
    });

    it('should call fn when request is received', function (done) {
      let _method = 'echo';
      let _data = { hello: 'world' };

      server = new transport.Server(function (method, data, callback) {
        assert.strictEqual(method, _method);
        assert.deepStrictEqual(data, _data);
        callback(null, _data);
      });

      server.listen(function (err) {
        assert.ifError(err);

        request({
          url: 'http://' + host + ':' + port + '/ht',
          method: 'POST',
          json: { method: _method, args: _data }
        }, function (e, r, body) {
          assert.ifError(e);
          assert.deepStrictEqual(body, _data);
          server.stop(done);
        });
      });
    });

    it('should return error if fn does', function (done) {
      let _err = 'err!';

      server = new transport.Server(function (method, data, callback) {
        return callback(_err);
      });

      server.listen(function (err) {
        assert.ifError(err);

        request({
          url: 'http://' + host + ':' + port + '/ht',
          method: 'POST',
          json: {}
        }, function (e, r, body) {
          assert.ifError(e);

          assert.strictEqual(body.$htTransportError, _err);

          server.stop(done);
        });
      });
    });

    it('should enable HTTPS if SSL options are specified', function (done) {
      let _method = 'something';
      let _data = { hello: 'world' };

      let cert = SSLKeys.cert;
      let key = SSLKeys.key;
      let ca = SSLKeys.ca;

      let transport = new HTTP({
        port: port,
        host: host,
        ssl: {
          cert: cert,
          key: key,
          ca: [ca],
          agent: false,
          rejectUnauthorized: false
        }
      });

      let server = new transport.Server(function (method, data, callback) {
        return callback(null, data);
      });

      assert.strictEqual(server.config.ssl.cert, SSLKeys.cert);

      server.listen(function (err) {
        assert.ifError(err);

        // This needs to be set or else http.request will
        // throw an error because we're using self signed
        // certificates..
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        request({
          url: 'https://' + host + ':' + port + '/ht',
          method: 'POST',
          json: { method: _method, args: _data }
        }, function (e, r, body) {
          assert.ifError(e);

          assert.strictEqual(body.hello, _data.hello);

          server.stop(done);
        });
      });
    });

    it('should stringify error if needed', function (done) {
      let _errmsg = 'hello world error';

      server = new transport.Server(function (method, data, callback) {
        callback(new Error(_errmsg));
      });

      server.listen(function (err) {
        assert.ifError(err);

        request({
          url: 'http://' + host + ':' + port + '/ht',
          method: 'POST',
          json: { method: 'blah', args: 'blah' }
        }, function (e, r, body) {
          assert.ifError(e);
          assert.deepStrictEqual(body.$htTransportError, _errmsg);
          server.stop(done);
        });
      });
    });

    it('should let multiple services listen on the same port using app', function (done) {
      let app = express();

      let transport1 = new HTTP({ app: app, path: '/one' });
      let transport2 = new HTTP({ app: app, path: '/two' });

      let server1 = new transport1.Server(function (method, data, callback) { //eslint-disable-line
        assert.strictEqual(method, 'method1');
        return callback(null, data);
      });

      let server2 = new transport2.Server(function (method, data, callback) { //eslint-disable-line
        assert.strictEqual(method, 'method2');
        return callback(null, data);
      });

      let server = app.listen(port, host, function (err) {
        assert.ifError(err);

        request({
          url: 'http://' + host + ':' + port + '/one',
          method: 'POST',
          json: { method: 'method1', args: 'method 1' }
        }, function (e, r, body) {
          assert.ifError(e);
          assert.deepStrictEqual(body, 'method 1');

          request({
            url: 'http://' + host + ':' + port + '/two',
            method: 'POST',
            json: { method: 'method2', args: 'method 2' }
          }, function (e, r, body) {
            assert.ifError(e);
            assert.deepStrictEqual(body, 'method 2');

            server.close(done);
          });
        });
      });
    });

    it('should noop listen if custom app is passed', function (done) {
      let app = express();

      let transport = HTTP({ app: app });

      let server = new transport.Server();

      server.listen(done);
    });

    it('should noop stop if custom app is passed', function (done) {
      let app = express();

      let transport = HTTP({ app: app });

      let server = new transport.Server();

      // Make sure server thinks it's listening
      server.listening = true;

      server.stop(done);
    });
  });

  describe('Client', function () {
    it('should have created client', function () {
      let client = new transport.Client();
      assert.strictEqual(client instanceof transport.Client, true);
    });

    it('should provide noop\'d versions of unused methods', function () {
      let noop = function noop () {};

      let client = new transport.Client();

      client.connect(noop);
      client.disconnect(noop);
    });

    it('should be able to call method', function (done) {
      let _method = 'hello';
      let _data = { something: 'world' };

      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        let _req$body = req.body;
        let method = _req$body.method;
        let args = _req$body.args;

        assert.strictEqual(method, _method);
        assert.deepStrictEqual(args, _data);
        res.json(_data);
      });

      let client = new transport.Client();

      let _server = app.listen(port, host, function () {
        client.call(_method, _data, function (err, response) {
          assert.ifError(err);
          assert.deepStrictEqual(response, _data);
          _server.close(done);
        });
      });
    });

    it('should be able to call method with non ascii characters', function (done) {
      let _method = 'hello';
      let _data = { thai_chars: 'วรรณยุต' };

      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        let _req$body = req.body;
        let method = _req$body.method;
        let args = _req$body.args;

        assert.strictEqual(method, _method);
        assert.deepStrictEqual(args, _data);
        res.json(_data);
      });

      let client = new transport.Client();

      let _server = app.listen(port, host, function () {
        client.call(_method, _data, function (err, response) {
          assert.ifError(err);
          assert.deepStrictEqual(response, _data);
          _server.close(done);
        });
      });
    });

    it('should successfully return error', function (done) {
      let _method = 'hello';
      let _error = 'therewasanerror';

      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        res.json({
          $htTransportError: _error
        });
      });

      let client = new transport.Client();

      let _server = app.listen(port, host, function () {
        client.call(_method, null, function (err) {
          assert.deepStrictEqual(err, _error);
          _server.close(done);
        });
      });
    });

    it('should return error if request cannot be made', function (done) {
      let client = new transport.Client();

      client.config.port = 2000;

      client.call('', {}, function (err) {
        assert.strictEqual(err.substr(0, 20), 'connect ECONNREFUSED');

        client.config.port = port;

        done();
      });
    });

    it('should timeout if server does not respond in time', function (done) {
      this.timeout(2000);
      const app = express();
      app.post('/ht', function (req, res) {
      });

      const transport = new HTTP({
        port,
        host,
        timeout: 1000
      });
      const client = new transport.Client();

      const _app = app.listen(port, host, function () {
        client.call('', {}, function (err) {
          assert.equal(err, 'Timeout of 1000ms exceeded');
          _app.close(done);
        });
      });
    });

    it('should not timeout when server responds in time', function (done) {
      this.timeout(2000);
      let _response = { something: 'world' };
      const app = express();
      app.post('/ht', function (req, res) {
        res.send(_response);
      });

      const transport = new HTTP({
        port,
        host,
        timeout: 1000
      });
      const client = new transport.Client();

      const _app = app.listen(port, host, function () {
        client.call('', {}, function (err, response) {
          assert.equal(err, undefined);
          assert.notStrictEqual(response, _response);
          _app.close(done);
        });
      });
    });

    it('should enable HTTPS if SSL options are specified', function (done) {
      let _method = 'hello';
      let _data = { something: 'world' };

      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        let _req$body2 = req.body;
        let method = _req$body2.method;
        let args = _req$body2.args;

        assert.strictEqual(req.secure, true);
        assert.strictEqual(method, _method);
        assert.deepStrictEqual(args, _data);
        res.json(_data);
      });

      let transport = new HTTP({
        host: host,
        port: port,
        ssl: true
      });

      let client = new transport.Client();

      let _app = https.createServer(SSLKeys, app);

      _app.listen(port, host, function () {
        client.call(_method, _data, function (err, response) {
          assert.ifError(err);
          assert.deepStrictEqual(response, _data);
          _app.close(done);
        });
      });
    });

    it('should return response even if response is not valid JSON', function (done) {
      let str = 'hello';

      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        res.end(str);
      });

      let client = new transport.Client();

      let _server = app.listen(port, host, function () {
        client.call('a', 'b', function (err) {
          assert.strictEqual(err, str);
          _server.close(done);
        });
      });
    });

    it('should not crash if response is undefined', function (done) {
      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        res.json(undefined);
      });

      let client = new transport.Client();

      let _server = app.listen(port, host, function () {
        client.call('a', 'b', function (err, response) {
          assert.ifError(err);
          assert.strictEqual(response, undefined);
          _server.close(done);
        });
      });
    });

    it('should be able to pass custom headers to a call', function (done) {
      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        res.json(req.headers);
      });

      let client = new transport.Client();

      let _server = app.listen(port, host, function (err) {
        assert.ifError(err);
        client.call('method', {}, function (err, response) {
          assert.ifError(err);
          assert.strictEqual(response.mycustomheader, '42');
          _server.close(done);
        }, {
          headers: {
            mycustomheader: 42
          }
        });
      });
    });

    it('should not call callback twice if callee throws from callback function', function (done) {
      this.timeout(1000);
      let app = express();
      app.use(bodyParser.json());
      app.post('/ht', function (req, res) {
        res.json({
          data: req.body
        });
      });

      let d = domain.create();

      let client = new transport.Client();

      let _server = app.listen(port, host, function () {
        d.on('error', function (err) {
          assert.strictEqual(err.message, 'unwind');
          return _server.close(done);
        });
        d.run(function () {
          client.call('method', {
            hello: 'world'
          }, function (err, response) {
            if (err) {
              assert.strictEqual(err, undefined, 'err not undefined, stack has unwinded back into Transport');
            }

            throw new Error('unwind');
          });
        });
      });
    });
  });
});
