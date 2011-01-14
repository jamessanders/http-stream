HttpStream = {};
(function(exports){
  function EventEmitter () {
    void(0);
  };
  EventEmitter.prototype.on = EventEmitter.prototype.addEventListener = function (event, callback) {
    if (!this._events) this._events = {};
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(callback);
    return this;
  };

  EventEmitter.prototype.emit = function () {
    if (!this._events) this._events = {};
    var event  = arguments[0];
    var args   = Array.prototype.slice.call(arguments).slice(1);
    var events = this._events[event] ? this._events[event] : [];
    for (var i = 0; i < events.length; i++) {
      events[i].apply(this, args);
    }
    return this;
  };  

  EventEmitter.prototype.removeListener = function (event, listener) {
    if (this._events[event]) {
      for (var i = 0; i < this._events[event].length; i++) {
        if (this._events[event][i] == listener) {
          delete this._events[event][i];
        }
      }
    }
    return this;
  };
  
  EventEmitter.prototype.removeAllListeners = function (event) {
    if (this._events[event]) {
      this._events[event] = [];
    }
    return this;
  };

  // HTTP Socket

  function JQueryBackend() {
    this.get = function get(obj) {
      $.ajax({ "url": obj.url,
               "success": obj.success,
               "complete": obj.complete
             });
    };
    this.post = function post(obj) {
      $.ajax({ "type": 'POST',
               "url": obj.url,
               "success": obj.success,
               "complete": obj.complete,
               "data": obj.data
             });
    };
  };

  function HttpSocket (hostname, port, backend) {

    var self = this;
    var session_id;
    var failures = 0;

    if (!backend) backend = new JqueryBackend();

    function readLoop () {
      backend.get({ 
        "url": "/stream/read/"+session_id, 
        "success": function(data) {
          failures = 0;
          var parsed = data.split('\x00');
          parsed.reverse();
          for (var i = 0; i < parsed.length; i++) {
            if (parsed[i]) self.emit("data", parsed[i]);
          }
        },
        "complete": function(){if(failures < 5) setTimeout(readLoop,1)}
      });
    };

    function connect() {
      backend.get({
        "url": "/stream/open",
        "success": function(data) {
          session_id = data;
          readLoop();
          self.emit("connect");
        }
      });
    };
    
    this.write = this.send = function write (data, callback) {
      backend.post({
        "url":"/stream/write/"+session_id, 
        "data": data, 
        "success": callback
      });
    };

    connect();

  }
  HttpSocket.prototype = EventEmitter.prototype;
  exports.HttpSocket = HttpSocket;
  exports.HttpStream = HttpSocket;
})(HttpStream);
