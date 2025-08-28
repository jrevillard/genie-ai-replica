// vue.config.js
module.exports = {
  devServer: {
    hot: true,
    port: 8090, // Development server runs on port 8090
    allowedHosts: 'all',
    headers: {
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws://localhost:8090 wss://localhost:8090 wss://genie-ai.itu.int:443 ws://e2e-g2-109.ssdcloudindia.net:443 wss://e2e-g2-109.ssdcloudindia.net:443 https://genie-ai.itu.int https://e2e-g2-109.ssdcloudindia.net; font-src 'self' https://cdnjs.cloudflare.com data:; img-src 'self' data:;"
    },
    host: '0.0.0.0',
    client: {
      webSocketURL: {
        hostname: process.env.NODE_ENV === 'development' ? 'localhost' : 'genie-ai.itu.int',
        pathname: '/ws',
        port: process.env.NODE_ENV === 'development' ? 8090 : 443,
        protocol: process.env.NODE_ENV === 'development' ? 'ws' : 'wss'
      }
    },
    webSocketServer: 'ws',
    proxy: {
      '/api': {
        target: process.env.NODE_ENV === 'development' ? 'http://localhost:8090' : 'https://genie-ai.itu.int:443',
        changeOrigin: true,
        secure: true // Enable secure HTTPS connections
      },
      '/ws': {
        target: process.env.NODE_ENV === 'development' ? 'ws://localhost:8090' : 'wss://genie-ai.itu.int:443',
        ws: true,
        changeOrigin: true,
        secure: true // Enable secure WSS connections
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
      })
    ]
  }
};