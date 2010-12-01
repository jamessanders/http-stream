var events  = require("events");
var http    = require("http");
var fs      = require("fs");
var cookies = require("./lib/cookie-node");

function HttpStream (id, response) {

  var is_ready = response != undefined ? true : false;
  var wait_buffer = [];
  var self = this;
  var buffer_size = 0;
  var age;

  this.updateAge = function () {
    age = (new Date()).getTime();
    return this;
  };

  this.getAge = function () {
    return (((new Date()).getTime() - age));
  };

  this.getId = function () {
    return id;
  };

  this.updateResponseObject = function (new_resp) {
    this.updateAge();
    response = new_resp;
    is_ready = true;
    return this;
  };

  this.write = function (data, callback) {
    wait_buffer.push([data, callback]);
    buffer_size += data.length;
    return this;
  };

  this.close = function () {
    self.emit("close");
    return this;
  };

  this.getBufferSize = function () {
    return buffer_size;
  };

  this.isReady = function () {
    return is_ready;
  };

  function tick() {
    if (self.isReady() && wait_buffer.length > 0) {
      var packet = wait_buffer.pop();
      response.writeHead(200,{"Content-Type": "application/octet-stream"});
      response.end(packet[0]);
      buffer_size -= packet[0].length;
      is_ready = false;
      if (packet[1]) packet[1]();
    }
    process.nextTick(tick);
  };

  this.updateAge();
  tick();
}
HttpStream.prototype = events.EventEmitter.prototype;

MAX_BUFFER_SIZE = 1024 * 4; // 4 KB
MAX_AGE         = 10 * 1000; // 10 seconds

function HttpStreamServer (httpServer, prefix) {
    
  prefix = prefix ? prefix : "stream";
  var current_id = 0;
  var streams = {};
  var self = this;
  var server_id = Math.floor(Math.random() * 10000);
  
  function getNewId () {
    return ++current_id;
  };

  function tick () {
    console.log("TICK");
    for (key in streams) {
      if (streams.hasOwnProperty(key)) {
        if (!streams[key].isReady() && (streams[key].getBufferSize() > MAX_BUFFER_SIZE || streams[key].getAge() > MAX_AGE)) {
          streams[key].close();
          delete streams[key];
        }
      }
    }
    process.nextTick(tick);
  };
  tick();

  httpServer.on("request", function (req, res) {
    if (req.url.match(new RegExp("/"+prefix+"/open"))) {
      var new_id = getNewId();
      res.setCookie("stream"+server_id, new_id);
      var stream = new HttpStream(new_id);
      streams[current_id] = stream;
      res.writeHead(200,{});
      res.end("");
      process.nextTick(function() { self.emit("connection", stream); });
    } else if (req.url.match(new RegExp("/"+prefix+"/read"))) {
      var session_id = req.getCookie("stream"+server_id);
      if (session_id && streams[session_id]) {
        console.log("Found stream: ");
        console.log(streams[session_id].getId());
        streams[session_id].updateResponseObject(res);
      } else {
        res.writeHead(500, {});
        res.end("Internal Error");
      }
    } else {
      fs.readFile("./test.html", function(err, data) {
        res.writeHead(200,{"Content-Type": "text/html"});
        res.end(data);
      });
    }
  });

}
HttpStreamServer.prototype = events.EventEmitter.prototype

////////////////////////////////////////////////////////////////////////
// test app
////////////////////////////////////////////////////////////////////////

var http_server = http.createServer();
var stream_server = new HttpStreamServer(http_server);

stream_server.on("connection", function(stream) {
  console.log("Got connection for stream #"+stream.getId());
  var c = 0;
  var interval = setInterval(function() { 
    console.log("Writing to stream #" + stream.getId());
    stream.write(stream.getId() + " Hello world! " + (c++));
  }, 100);
  stream.on("close",function() { clearInterval(interval) });
});

http_server.listen(8080, "0.0.0.0");
