function create() {
  return {
    beginTransaction: function() { return Promise.resolve(); },
    execute: function(sql, params) { return require('./mock-db').query(sql, params); },
    query: function(sql, params) { return require('./mock-db').query(sql, params); },
    commit: function() { return Promise.resolve(); },
    rollback: function() { return Promise.resolve(); },
    release: function() {}
  };
}

module.exports = { create };
