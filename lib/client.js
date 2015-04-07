SearchSource = function SearchSource(source, fields, options) {
  this.source = source;
  this.searchFields = fields;
  this.currentQuery = null;
  this.options = options || {};

  this.status =  new ReactiveVar({loaded: true});
  this.metaData = new ReactiveVar({});
  this.history = {};
  this.store = new Mongo.Collection(null);

  this._storeDep = new Tracker.Dependency();
  this._currentQueryDep = new Tracker.Dependency();
  this._currentVersion = 0;
  this._loadedVersion = 0;
};

SearchSource.prototype._loadData = function(query, options) {
  var self = this;
  var version = 0;

  if(this._canUseHistory(query, options)) {
    this._updateStore(this.history[query].data);
    this.metaData.set(this.history[query].metadata);
    self._storeDep.changed();
    return;
  }

  if(options){
    if(this.options.keepHistory) {
      options = this._changeOptionsForWhatsInCache(query, options);
    }
  }

  this.status.set({loading: true});
  version = ++this._currentVersion;
  this._fetch(this.source, query, options, handleData);

  function handleData(err, payload) {
    if(err) {
      self.status.set({error: err});
      throw err;
    } else {
      if(payload instanceof Array) {
        var data = payload;
        var metadata = {};
      } else {
        var data = payload.data;
        var metadata = payload.metadata;
        self.metaData.set(payload.metadata || {});
      }

      if(self.options.keepHistory) {
        var range = {
          start: options.skip || 0
        };
        range.end = range.start + (options.limit || data.length);
        self._mergeInHistory(query, {
          data: data,
          range: range,
          loaded: new Date(),
          metadata: metadata
        });
      }

      if(version > self._loadedVersion) {
        if(self.options.keepHistory){
          //new data was already merge in history
          self._updateStore(self.history[query].data);
        } else {
          self._updateStore(data);
        }
        self._loadedVersion = version;
      }

      if(version == self._currentVersion) {
        self.status.set({loaded: true});
      }

      self._storeDep.changed();
    }
  }
};

SearchSource.prototype._canUseHistory = function(query, options) {
  if(this.options.keepHistory) {
    var historyItem = this.history[query];
    if(historyItem){
      //are limiting options within current range?
      if(options.skip || options.limit){
        if(!options.skip){
          options.skip = 0;
        }
        if(!options.limit){
          //TODO: default limit
          options.limit = 99999;
        }
        if( options.skip < historyItem.range.start ||
            (options.skip + options.limit) > historyItem.range.end){
          return false;
        }
      }
      var diff = Date.now() - historyItem.loaded.getTime();
      return diff < this.options.keepHistory;
    }
  }

  return false;
};

SearchSource.prototype._mergeInHistory = function(query, newData) {
  var current = this.history[query];
  if(!current){
    this.history[query] = newData;
    return;
  }
  if(current.range.start > newData.range.start){
    current.range.start = newData.range.start;
  }
  if(current.range.end < newData.range.end){
    current.range.end = newData.range.end;
  }

  //check what new data needs to be pushed to history data
  var currentIds = _.reduce(current.data, function(memo, d){
    memo[d._id] = true;
    return memo;
  }, {});

  _.each(newData.data, function(newDoc){
    if(!currentIds[newDoc._id]){
      current.data.push(newDoc);
    }
  });
  this.history[query] = current;
};

SearchSource.prototype._changeOptionsForWhatsInCache = function(query, options) {
  var historyItem = this.history[query];
  if(!historyItem){
    return options;
  }

  if(options.skip || options.limit){
    if(!options.skip){
      options.skip = 0;
    }
    if( options.skip < historyItem.range.end ){
      if(options.limit){
        options.limit -= (historyItem.range.end - options.skip);
      }
      options.skip = historyItem.range.end;
    }
  }

  return options;
};

SearchSource.prototype._updateStore = function(data) {
  var self = this;
  var storeIds = _.pluck(this.store.find({}, {fields: {_id: true}}).fetch(), "_id");
  var currentIds = [];
  data.forEach(function(item) {
    currentIds.push(item._id);
    self.store.update(item._id, item, {upsert: true});
  });

  var removedItem = _.difference(storeIds, currentIds);
  removedItem.forEach(function(id) {
    self.store.remove(id);
  });
};

SearchSource.prototype.search = function(query, options) {
  this.currentQuery = query;
  this._currentQueryDep.changed();

  this._loadData(query, options);

  if(this.options.localSearch) {
    this._storeDep.changed();
  }
};

SearchSource.prototype.getData = function(options, getCursor) {
  options = options || {};
  var self = this;
  this._storeDep.depend();
  var selector = {$or: []};

  var regExp = this._buildRegExp(self.currentQuery);

  // only do client side searching if we are on the loading state
  // once loaded, we need to send all of them
  if(this.getStatus().loading) {
    self.searchFields.forEach(function(field) {
      var singleQuery = {};
      singleQuery[field] = regExp;
      selector['$or'].push(singleQuery);
    });
  } else {
    selector = {};
  }

  function transform(doc) {
    if(options.transform) {
      self.searchFields.forEach(function(field) {
        if(self.currentQuery && doc[field]) {
          doc[field] = options.transform(doc[field], regExp, field, self.currentQuery);
        }
      });
    }
    if(options.docTransform) {
      return options.docTransform(doc);
    }
    
    return doc;
  }

  var cursor = this.store.find(selector, {
    sort: options.sort,
    limit: options.limit,
    transform: transform
  });

  if(getCursor) {
    return cursor;
  }

  return cursor.fetch();
};

SearchSource.prototype._fetch = function(source, query, options, callback) {
  if(typeof this.fetchData == 'function') {
    this.fetchData(query, options, callback);
  } else if(Meteor.status().connected) {
    this._fetchDDP.apply(this, arguments);
  } else {
    this._fetchHttp.apply(this, arguments);
  }
};

SearchSource.prototype._fetchDDP = function(source, query, options, callback) {
  Meteor.call("search.source", this.source, query, options, callback);
};

SearchSource.prototype._fetchHttp = function(source, query, options, callback) {
  var payload = {
    source: source,
    query: query,
    options: options
  };

  var headers = {
    "Content-Type": "text/ejson"
  };

  HTTP.post('/_search-source', {
    content: EJSON.stringify(payload),
    headers: headers
  }, function(err, res) {
    if(err) {
      callback(err);
    } else {
      var response = EJSON.parse(res.content);
      if(response.error) {
        callback(response.error);
      } else {
        callback(null, response.data);
      }
    }
  });
};

SearchSource.prototype.getMetadata = function() {
  return this.metaData.get();
};

SearchSource.prototype.getCurrentQuery = function() {
  this._currentQueryDep.depend();
  return this.currentQuery;
};

SearchSource.prototype.getStatus = function() {
  return this.status.get();
};

SearchSource.prototype.cleanHistory = function() {
  this.history = {};
};

SearchSource.prototype._buildRegExp = function(query) {
  query = query || "";

  var afterFilteredRegExpChars = query.replace(this._getRegExpFilterRegExp(), "\\$&");
  var parts = afterFilteredRegExpChars.trim().split(' ');

  return new RegExp("(" + parts.join('|') + ")", "ig");
};

SearchSource.prototype._getRegExpFilterRegExp = _.once(function() {
  var regExpChars = [
    "\\", "^", "$", "*", "+", "?", ".",
     "(", ")", ":", "|", "{", "}", "[", "]",
     "=", "!", ","
  ];
  var regExpCharsReplace = _.map(regExpChars, function(c) {
    return "\\" + c;
  }).join("|");
  return new RegExp("(" + regExpCharsReplace + ")", "g");
});