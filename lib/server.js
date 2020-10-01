import { Meteor } from 'meteor/meteor';
import { Picker } from 'meteor/communitypackages:picker';
import { EJSON } from 'meteor/ejson';
import { check } from 'meteor/check';
import { DDP } from 'meteor/ddp';
import bodyParser from 'body-parser';

export const SearchSource = {};
SearchSource._sources = {};

SearchSource.defineSource = function(name, callback) {
  SearchSource._sources[name] = callback;
};

Meteor.methods({
  "search.source": function(name, query, options) {
    check(name, String);
    check(query, Match.OneOf(String, null, undefined));
    check(options, Match.OneOf(Object, null, undefined));
    this.unblock();

    // we need to send the context of the method
    // that's why we use .call instead just invoking the function
    return getSourceData.call(this, name, query, options);
  }
});

const postRoutes = Picker.filter(function(req, res) {
  return req.method === "POST";
});

postRoutes.middleware(bodyParser.text({
  type: "text/ejson"
}));

postRoutes.route('/_search-source', function(params, req, res, next) {
  if(req.body) {
    const payload = EJSON.parse(req.body);
    try {
      // supporting the use of Meteor.userId()
      const data = DDP._CurrentInvocation.withValue({userId: null}, function() {
        return getSourceData(payload.source, payload.query, payload.options);
      });
      sendData(res, null, data);
    } catch(ex) {
      const error = ex instanceof Meteor.Error ? { code: ex.error, message: ex.reason } : { message: ex.message };
      sendData(res, error);
    }
  } else {
    next();
  }
});


function sendData(res, err, data) {
  const payload = {
    error: err,
    data: data
  };

  res.end(EJSON.stringify(payload));
}

function getSourceData(name, query, options) {
  const source = SearchSource._sources[name];
  if(source) {
    return source.call(this, query, options);
  } else {
    throw new Meteor.Error(404, "No such search source: " + name);
  }
}