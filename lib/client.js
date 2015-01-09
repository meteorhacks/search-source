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
}

SearchSource.prototype._loadData = function(query, options) {
  var self = this;
  var version = 0;
  if(this._canUseHistory(query)) {
    this._updateStore(this.history[query].data);
    this.metaData.set(this.history[query].metadata);
    self._storeDep.changed();
  } else {
    this.status.set({loading: true});
    version = ++this._currentVersion;
    Meteor.call("search.source", this.source, query, options, handleData);
  }

  function handleData(err, payload) {
    if(payload instanceof Array) {
      var data = payload;
      var metadata = {};
    } else {
      var data = payload.data;
      var metadata = payload.metadata;
      self.metaData.set(payload.metadata || {});
    }

    if(err) {
      self.status.set({error: err});
      throw err;
    } else {
      if(self.options.keepHistory) {
        self.history[query] = {data: data, loaded: new Date(), metadata: metadata};
      }

      if(version > self._loadedVersion) {
        self._updateStore(data);
        self._loadedVersion = version;
      }

      if(version == self._currentVersion) {
        self.status.set({loaded: true});
      }

      self._storeDep.changed();
    }
  }
};

SearchSource.prototype._canUseHistory = function(query) {
  var historyItem = this.history[query];
  if(this.options.keepHistory && historyItem) {
    var diff = Date.now() - historyItem.loaded.getTime();
    return diff < this.options.keepHistory;
  }

  return false;
};

SearchSource.prototype._updateStore = function(data) {
  var self = this;
  var storeIds = _.pluck(this.store.find().fetch(), "_id");
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

SearchSource.prototype.getData = function(options) {
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
    self.searchFields.forEach(function(field) {
      if(self.currentQuery && doc[field]) {
        if(options.transform) {
          doc[field] = options.transform(doc[field], regExp, field, self.currentQuery);
        }
      }
    });
    return doc;
  }

  return this.store.find(selector, {
    sort: options.sort, 
    limit: options.limit, 
    transform: transform
  }).fetch();
};

SearchSource.prototype.getMetadata = function() {
  return this.metaData.get();
};

SearchSource.prototype.getCurrentQuery = function() {
  this._currentQueryDep.depend();
  return this.currentQuery;
}

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