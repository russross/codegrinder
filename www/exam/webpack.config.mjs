import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientCoreModules, clientCoreRules } from './client-core/build/webpack.mjs';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const config = {
  mode: 'development',
  entry: './index.ts',
  output: {
    path: path.resolve(dirname, 'dist'),
    filename: 'bundle.js',
    library: 'codegrinder',
    libraryTarget: 'window',
  },
  module: {
    rules: [
      ...clientCoreRules(),
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    modules: [clientCoreModules, path.resolve(dirname, 'node_modules'), 'node_modules'],
  },
};

export default config;
