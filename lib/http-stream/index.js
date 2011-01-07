var events  = require("events");
var http    = require("http");
var fs      = require("fs");
var uuid    = require("./uuid");

function HttpStream (id) {

  this.id = id;
  this.connection_queue = [];
  this.wait_buffer = [];
  this.buffer_size = 0;
  this.age = (new Date()).getTime();
  this.ticked = false;

}

HttpStream.prototype = events.EventEmitter.prototype;

HttpStream.prototype.updateAge = function () {
  this.age = (new Date()).getTime();
  return this;
};

HttpStream.prototype.getAge = function () {
  return this.age;
};

HttpStream.prototype.getId = function () {
  return this.id;
};

HttpStream.prototype.addConnection = function (req, res) {
  this.updateAge();
  this.connection_queue.push([req, res]);
  return this;
};

HttpStream.prototype.removeConnection = function (req, res) {
  this.updateAge();
  var out = [];
  for (var i = 0; i < this.connection_queue.length; i++) {
    if (this.connection_queue[i][0] == req && this.connection_queue[i][1] == res) {
      console.log("!! Deleting connection !!");
    } else {
      out.push(this.connection_queue[i]);
    }
  }
  this.connection_queue = out;
  return this;
};

HttpStream.prototype.getNextConnection = function () {
  this.updateAge();
  return this.connection_queue.pop();
};

HttpStream.prototype.getBufferSize = function () {
  return this.buffer_size;
};

HttpStream.prototype.isReady = function () {
  return (this.connection_queue.length > 0);
};

// when stream/read
HttpStream.prototype.updateResponseObject = function (req, res) {
  var self = this;
  function unmark (event) {
    return function () {
      console.log("Got event: (" + event + ") on connection: " + self.id);
      console.log("Connection died for: " + self.id); 
      self.removeConnection(req, res);
    }
  }
  self.addConnection(req, res);
  self.doTick();

  // If the connection closes we should remove it from the connection queue
  req.connection.on("close", unmark("close"));
  req.connection.on("end", unmark("end"));

  return this;
};

// when stream/write
HttpStream.prototype.handleHttpPost = function (req, res) {
  var self = this;
  this.updateAge();
  req.setEncoding("utf8");

  var buffer = "";
  req.on("data", function(data) {
    buffer += data;
  });

  req.on("end", function () {
    self.emit("data", buffer);
    self.emit("message", buffer);
    res.writeHead(200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
    res.end("OK");
  });

};

HttpStream.prototype.send = HttpStream.prototype.write = function (data, callback) {
  this.wait_buffer.push([data, callback]);
  this.buffer_size += data.length;
  this.doTick();
  return this;
};

HttpStream.prototype.close = function () {
  this.emit("close");
  return this;
};

HttpStream.prototype.tick = function () {
  this.ticked = false;
  var self = this;
  var connection;
  if (this.isReady() && this.wait_buffer.length > 0 && (connection = this.getNextConnection())) {
    var response = connection[1];
    response.writeHead(200,{"Content-Type": "application/octet-stream", "Access-Control-Allow-Origin": "*"});
    while (this.wait_buffer.length > 0) {
      var packet = this.wait_buffer.pop();
      response.write(packet[0]);
      response.write('\x00');
      this.buffer_size -= packet[0].length;
      if (packet[1]) packet[1]();
    }
    response.end();
  }
};

HttpStream.prototype.doTick = function () {
  var self = this;
  if (!this.ticked) {
    this.ticked = true;
    process.nextTick(function() { process.nextTick(function() { self.tick() }) });
  }
};

////////////////////////////////////////////////////////////////////////

MAX_BUFFER_SIZE = 1024 * 10; // 10 KB
MAX_AGE         = 1000 * 5 ; // 5 seconds

function HttpStreamServer (httpServer, prefix) {
    
  prefix = prefix ? prefix : "stream";
  var current_id = 0;
  var streams = {};
  var self = this;
  var server_id = Math.floor(Math.random() * 10000);
  var ticked = false;
  
  function getNewId () {
    return (++current_id) + "-" + uuid.getUuid();
  };

  function tick () {
    console.log("TICK");
    var c = 0;
    ticked = false;
    var now = (new Date()).getTime();
    for (key in streams) {
      if (streams.hasOwnProperty(key)) {
        c++;
        if ((!streams[key].isReady()) && (streams[key].getBufferSize() > MAX_BUFFER_SIZE || (now - streams[key].getAge()) > MAX_AGE)) {
          console.log("Stream key: " + key);
          console.log("Stream is ready: " + streams[key].isReady());
          console.log("Stream age     : " + (now - streams[key].getAge()));
          console.log("Stream buffer size    : " + streams[key].getBufferSize());
          console.log("DELETING STREAM: " + key);
          streams[key].close();
          delete streams[key];
        } 
      }
    }
    console.log("Total Clients: " + c);
  };
  
  function doTick () {
    if (!ticked) {
      ticked = true;
      process.nextTick(tick);
    }
  }

  // Run our GC every MAX_AGE seconds no matter what.
  setInterval(doTick, MAX_AGE);

  var orig_request_listeners = httpServer.listeners("request");
  httpServer.removeAllListeners("request");
  for (var i = 0; i < orig_request_listeners.length; i++) {
    httpServer.on("_request", orig_request_listeners[i]);
  }

  httpServer.on("request", function (req, res) {
    var match;
    // Open
    if (req.url.match(new RegExp("^/"+prefix+"/open$"))) {
      var new_id = getNewId();
      var stream = new HttpStream(new_id);
      streams[new_id] = stream;
      res.writeHead(200, {"Content-Type":"text/plain", "Access-Control-Allow-Origin": "*"});
      res.end(""+new_id);
      process.nextTick(function() { self.emit("connection", stream); });
      doTick();
      // Read
    } else if (match = req.url.match(new RegExp("^/"+prefix+"/read/(.*)$"))) {
      var session_id = match[1];
      if (session_id && streams[session_id]) {
        console.log("Found stream: ");
        console.log(streams[session_id].getId());
        streams[session_id].updateResponseObject(req, res);
      } else {
        res.writeHead(500, {"Access-Control-Allow-Origin": "*"});
        res.end("Internal Error");
      }
      doTick();
      // Write
    } else if (match = req.url.match(new RegExp("^/"+prefix+"/write/(.*)$"))) {
      var session_id = match[1];
      if (session_id && streams[session_id]) {
        console.log("Found stream: ");
        console.log(streams[session_id].getId());
        streams[session_id].handleHttpPost(req, res);
      } else {
        res.writeHead(500, {"Access-Control-Allow-Origin": "*"});
        res.end("Internal Error");
      }
      doTick();
      // Pass off to original server
    } else {
      httpServer.emit("_request", req, res);
    }
  });

}
HttpStreamServer.prototype = events.EventEmitter.prototype;
exports.HttpStreamServer = HttpStreamServer;
////////////////////////////////////////////////////////////////////////
// test app
////////////////////////////////////////////////////////////////////////
/*
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
*/
