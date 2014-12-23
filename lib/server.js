SearchSource = {};
SearchSource._sources = {};

SearchSource.defineSource = function(name, callback) {
  SearchSource._sources[name] = callback;
};

Meteor.methods({
  "search.source": function(name, query, options) {
    check(name, String);
    check(query, Match.OneOf(String, null, undefined));
    check(options, Match.OneOf(String, null, undefined));
    this.unblock();

    var source = SearchSource._sources[name];
    if(source) {
      return source.call(this, query, options);
    } else {
      throw new Meteor.Error("No such search source: " + name);
    }
  }
});