module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "2021", // Allows for the parsing of modern ECMAScript features
    sourceType: "module", // Allows for the use of imports
  },

  extends: [
    "plugin:prettier/recommended", // Always need to be last
  ],

  rules: {},
};
