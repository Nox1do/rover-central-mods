module.exports = {
  content: {
    files: ['./verificadores/Rs-Verificador-Lineas.user.js'],
    transform: { js: source => source.replace(/const tailwind = create\('style', [^\n]*\);/, '') }
  },
  prefix: 'tw-',
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: []
};
