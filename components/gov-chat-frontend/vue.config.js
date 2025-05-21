// vue.config.js
module.exports = {
  devServer: {
    hot: true,
    port: 8090,
    allowedHosts: 'all',
    headers: {
      'Access-Control-Allow-Origin': '*',
      // More comprehensive CSP header with default-src and script-src
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' wss://e2e-g2-109.ssdcloudindia.net:8090 wss://e2e-g2-109.ssdcloudindia.net:8098 ws://0.0.0.0:8090 ws://0.0.0.0:8090/ws https://e2e-g2-109.ssdcloudindia.net:*; font-src 'self' https://cdnjs.cloudflare.com data:; img-src 'self' data:;"
    },
    host: '0.0.0.0',
    client: {
      webSocketURL: {
        hostname: '0.0.0.0',
        pathname: '/ws',
        port: 8090
      }
    },
    webSocketServer: 'ws',
    // Add proxy configuration for WebSocket connections
    proxy: {
      '/api': {
        target: 'https://e2e-g2-109.ssdcloudindia.net:8098',
        changeOrigin: true,
        secure: false
      },
      '/ws': {
        target: 'wss://e2e-g2-109.ssdcloudindia.net:8098',
        ws: true,
        changeOrigin: true,
        secure: false
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
        vm: require.resolve('vm-browserify')  // Add this line
      }
    },
    plugins: [
      new (require('webpack')).ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser'
      })
    ]
  }
};