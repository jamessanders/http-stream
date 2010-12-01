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

  this.handleHttpPost = function (req, res) {
    req.setEncoding("utf8");
    var buffer = "";
    req.on("data", function(data) {
      buffer += data;
    });
    req.on("end", function () {
      self.emit("data", buffer);
      res.writeHead(200, {"Content-Type": "text/plain"});
      res.end("OK");
    });
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
      response.writeHead(200,{"Content-Type": "application/octet-stream"});
      self.updateAge();
      is_ready = false;
      while (wait_buffer.length > 0) {
        var packet = wait_buffer.pop();
        response.write(packet[0]);
        response.write('\x00');
        buffer_size -= packet[0].length;
        if (packet[1]) response.end(packet[1]);
      }
      response.end();
    }
    process.nextTick(tick);
  };

  this.updateAge();
  tick();
}
HttpStream.prototype = events.EventEmitter.prototype;

MAX_BUFFER_SIZE = 1024 * 10; // 10 KB
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
    for (key in streams) {
      if (streams.hasOwnProperty(key)) {
        //console.log("SIZE: " + streams[key].getBufferSize());
        if ((!streams[key].isReady()) && (streams[key].getBufferSize() > MAX_BUFFER_SIZE || streams[key].getAge() > MAX_AGE)) {
          console.log("Stream is ready: " + streams[key].isReady());
          console.log("Stream age     : " + streams[key].getAge());
          console.log("Stream size    : " + streams[key].getBufferSize());
          console.log("DELETING STREAM: " + key);
          streams[key].close();
          delete streams[key];
        }
      }
    }
    process.nextTick(tick);
  };
  tick();

  httpServer.on("request", function (req, res) {
    // Open
    if (req.url.match(new RegExp("^/"+prefix+"/open$"))) {
      var new_id = getNewId();
      res.setCookie("stream"+server_id, new_id);
      var stream = new HttpStream(new_id);
      streams[current_id] = stream;
      res.writeHead(200, {"Content-Type":"text/plain"});
      res.end("OK");
      process.nextTick(function() { self.emit("connection", stream); });

      // Read
    } else if (req.url.match(new RegExp("^/"+prefix+"/read$"))) {
      var session_id = req.getCookie("stream"+server_id);
      if (session_id && streams[session_id]) {
        console.log("Found stream: ");
        console.log(streams[session_id].getId());
        streams[session_id].updateResponseObject(res);
      } else {
        res.writeHead(500, {});
        res.end("Internal Error");
      }

      // Write
    } else if (req.url.match(new RegExp("^/"+prefix+"/write$"))) {
      var session_id = req.getCookie("stream"+server_id);
      if (session_id && streams[session_id]) {
        console.log("Found stream: ");
        console.log(streams[session_id].getId());
        streams[session_id].handleHttpPost(req, res);
      } else {
        res.writeHead(500, {});
        res.end("Internal Error");
      }

      // Pass off to original server
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
  }, 20000);
  stream.on("data", function (data) {
    console.log("I GOT SOME DATA: " + data);  
    stream.write("You Said: " + data);
  });
  stream.on("close",function() { clearInterval(interval) });
});

http_server.listen(8080, "0.0.0.0");
