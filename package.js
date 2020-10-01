Package.describe({
  "summary": "Reactive Data Source for Search",
  "version": "1.5.0",
  "git": "https://github.com/meteorhacks/search-source.git",
  "name": "meteorhacks:search-source"
});

Npm.depends({
  "body-parser": "1.19.0"
});

Package.onUse(function(api) {
  configurePackage(api);
  api.export(['SearchSource']);
});

Package.onTest(function(api) {
  configurePackage(api);

  api.use(['tinytest', 'mongo-livedata'], ['client', 'server']);
});

function configurePackage(api) {
  api.versionsFrom('1.9');
  api.use([
    'tracker', 'mongo', 'reactive-var',
    'http', 'ejson'
  ], ['client']);

  api.use(['ejson', 'check', 'ddp'], ['server']);
  
  api.use('communitypackages:picker@1.1.0', 'server');

  api.use('ecmascript');

  api.mainModule('lib/server.js', 'server');

  api.mainModule('lib/client.js', 'client');
}
