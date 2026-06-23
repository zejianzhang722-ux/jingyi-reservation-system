let mode = 'uninitialized';

module.exports = {
  get: function() { return mode; },
  set: function(value) { mode = value; }
};
