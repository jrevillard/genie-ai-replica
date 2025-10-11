// vue.config.js
const { DefinePlugin } = require('webpack');

// Read the CSP connect-src from an environment variable.
// This allows us to configure it in docker-compose.yaml for different environments.
// It includes a safe default for local development.
const cspConnectSrc = process.env.VUE_APP_CSP_CONNECT_SRC || "'self' http://localhost:3000 ws://localhost:8090";

module.exports = {
  devServer: {
    hot: true,
    port: 8090,
    allowedHosts: 'all',
    headers: {
      // Use the dynamically configured CSP
      'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src ${cspConnectSrc}; font-src 'self' https://cdnjs.cloudflare.com data:; img-src 'self' data:;`
    },
    host: '0.0.0.0',
    client: {
      webSocketURL: 'auto://0.0.0.0:0/ws'
    },
    // The proxy is not needed if your app calls the full URL directly, but is kept for reference.
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // Should point to your backend service
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000', // Should point to your backend service
        ws: true,
        changeOrigin: true,
      }
    }
  },
  configureWebpack: {
    resolve: {
      fallback: {
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer/'),
        util: require.resolve('util/'),
        process: require.resolve('process/browser'),
        zlib: require.resolve('browserify-zlib'),
        assert: require.resolve('assert/'),
        vm: require.resolve('vm-browserify')
      }
    },
    plugins: [
      new (require('webpack')).ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser'
      }),
      // This makes environment variables available in your Vue app code
      new DefinePlugin({
        'process.env': {
          VUE_APP_API_URL: JSON.stringify(process.env.VUE_APP_API_URL)
        }
      })
    ]
  }
};