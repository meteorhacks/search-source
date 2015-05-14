search-source
=============

#### Reactive Data Source for building search solutions with Meteor

If you are new to search source, it's a good idea to look at this introductory [article](https://meteorhacks.com/implementing-an-instant-search-solution-with-meteor.html) on MeteorHacks.

## Installation

```
meteor add meteorhacks:search-source
```

### Creating a source in client

```js
var options = {
  keepHistory: 1000 * 60 * 5,
  localSearch: true
};
var fields = ['packageName', 'description'];

PackageSearch = new SearchSource('packages', fields, options);
```

* First parameter for the source is the name of the source itself. You need to use it for defining the data source on the server.
* second arguments is the number of fields to search on the client (used for client side search and text transformation)
* set of options. Here are they
    * `keepHistory` - cache the search data locally. You need to give an expire time(in millis) to cache it on the client. Caching is done based on the search term. Then if you search again for that term, it search source won't ask the server to get data again.
    * `localSearch` - allow to search locally with the data it has.

### Define the data source on the server

In the server, get data from any backend and send those data to the client as shown below. You need to return an array of documents where each of those object consists of `_id` field.

> Just like inside a method, you can use `Meteor.userId()` and `Meteor.user()` inside a source definition.

```js
SearchSource.defineSource('packages', function(searchText, options) {
  var options = {sort: {isoScore: -1}, limit: 20};

  if(searchText) {
    var regExp = buildRegExp(searchText);
    var selector = {packageName: regExp, description: regExp};
    return Packages.find(selector, options).fetch();
  } else {
    return Packages.find({}, options).fetch();
  }
});

function buildRegExp(searchText) {
  var words = searchText.trim().split(/[ \-\:]+/);
  var exps = _.map(words, function(word) {
    return "(?=.*" + word + ")";
  });
  var fullExp = exps.join('') + ".+";
  return new RegExp(fullExp, "i");
}
```

### Get the reactive data source

You can get the reactive data source with the `PackageSearch.getData` api. This is an example usage of that:

```js
Template.searchResult.helpers({
  getPackages: function() {
    return PackageSearch.getData({
      transform: function(matchText, regExp) {
        return matchText.replace(regExp, "<b>$&</b>")
      },
      sort: {isoScore: -1}
    });
  }
});
```

`.getData()` api accepts an object with options (and an optional argument to ask for a cursor instead of a fetched array; see example below). These are the options you can pass:

* `transform` - a transform function to alter the selected search texts. See above for an example usage.
* `sort` - an object with MongoDB sort specifiers
* `limit` - no of objects to limit
* `docTransform` - a transform function to transform the documents in the search result. Use this for computed values or model helpers. (see example below)


```js
Template.searchResult.helpers({
  getPackages: function() {
    return PackageSearch.getData({
      docTransform: function(doc) {
        return _.extend(doc, {
          owner: function() {
            return Meteor.users.find({_id: this.ownerId})
          }
        })
      },
      sort: {isoScore: -1}
    }, true);
  }
});
```

### Searching

Finally we can invoke search queries by invoking following API.

```js
PackageSearch.search("the text to search");
```

### Status

You can get the status of the search source by invoking following API. It's reactive too.

```
var status = PackageSearch.getStatus();
```

Status has following fields depending on the status.

* loading - indicator when loading
* loaded - indicator after loaded
* error - the error object, mostly if backend data source throws an error

### Metadata

With metadata, you get some useful information about search along with the search results. These metadata can be time it takes to process the search or the number of results for this search term.

You can get the metadata with following API. It's reactive too.

```js
var metadata = PackageSearch.getMetadata();
```

Now we need a way to send metadata to the client. This is how we can do it. You need to change the server side search source as follows

```js
SearchSource.defineSource('packages', function(searchText, options) {
  var data = getSearchResult(searchText);
  var metadata = getMetadata();

  return {
    data: data,
    metadata: metadata
  }
});
```

### Passing Options with Search

We can also pass some options while searching. This is the way we can implement pagination and other extra functionality.

Let's pass some options to the server:

```js
// In the client
var options = {page: 10};
PackageSearch.search("the text to search", options);
```

Now you can get the options object from the server. See:

```js
// In the server
SearchSource.defineSource('packages', function(searchText, options) {
  // do anything with options
  console.log(options); // {"page": 10}
});
```

### Get Current Search Query

You can get the current search query with following API. It's reactive too.

```js
var searchText = PackageSearch.getCurrentQuery();
```

### Clean History

You can clear the stored history (if enabled the `keepHistory` option) via the following API.

```js
PackageSearch.cleanHistory();
```

### Defining Data Source in the Client

Sometime, we don't need to fetch data from the server. We need to get it from a data source aleady available on the client. So, this is how we do it:

```js
PackageSearch.fetchData = function(searchText, options, success) {
  SomeOtherDDPConnection.call('getPackages', searchText, options, function(err, data) {
    success(err, data);
  });
};
```
