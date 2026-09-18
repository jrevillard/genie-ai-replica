module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        // CJS for Node test runtime; transforms ESM `export default`
        // in dependencies (kdbush v4) into `module.exports.default`.
        targets: { node: 'current' },
        modules: 'commonjs'
      }
    ]
  ]
};
