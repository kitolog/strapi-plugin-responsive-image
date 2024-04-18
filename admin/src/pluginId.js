const pluginPkg = require('../../package.json');
const pluginId = pluginPkg.name.replace(
  /^strapi-plugin-watermark-/i,
  ''
);

module.exports = pluginId;
