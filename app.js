var events = require("events");

function HttpStream (id, response) {

  var is_ready = response ? true : false;
  var wait_buffer = [];
  var wait_callbacks = [];

  this.getId = function () {
    return id;
  };

  this.updateResponseObject = function (new_resp) {
    response = new_resp;
    is_ready = true;
    return this;
  };

  this.write = function (data, callback) {
    wait_buffer.push(data);
    wait_callbacks.push(callback);
    return this;
  };

  this.isReady = function () {
    return is_ready;
  };

  function tick() {
    if (this.isReady() && wait_buffer.length > 0) {
      response.writeHead(200);
      response.end(wait_buffer.join(""));
      wait_buffer = [];
      is_ready = false;
      for (var i = 0; i < wait_callbacks.length; i++) {
        wait_callbacks.pop()();
      }
    }
    process.nextTick(tick);
  };
  tick();

}

function HttpStreamServer (httpServer) {

  var current_id = 1;
  var streams = {};
  
  this.

}
