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
  } else {
    this.status.set({loading: true});
    version = ++this._currentVersion;
    Meteor.call("search.source", this.source, query, options, handleData);
  }

  function handleData(err, payload) {
    if(payload instanceof Array) {
      data = payload;
    } else {
      data = payload.data;
      self.metaData.set(payload.metadata || {});
    }

    if(err) {
      self.status.set({error: err});
      throw err;
    } else {
      if(self.options.keepHistory) {
        self.history[query] = {data: data, loaded: new Date()};
      }

      if(version > self._loadedVersion) {
        self._updateStore(data);
        self._loadedVersion = version;
      }

      if(version == self._currentVersion) {
        self.status.set({loaded: true});
      }
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

  self._storeDep.changed();
};

SearchSource.prototype.search = function(query, options) {
  this.currentQuery = query;
  this._currentQueryDep.changed();

  var historyForQuery = this.history[query];
  this._loadData(query, options);

  if(this.options.localSearch) {
    this._storeDep.changed();
  }
};

SearchSource.prototype.getData = function(sort, limit) {
  var self = this;
  this._storeDep.depend();
  var selector = {};
  self.searchFields.forEach(function(field) {
    selector[field] = new RegExp(self.currentQuery, 'i');
  });

  var regExp = new RegExp(self.currentQuery, "i");
  return this.store.find(selector, {sort: sort, limit: limit}).fetch();
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