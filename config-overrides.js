const path = require("path");
const { alias, aliasJest, configPaths } = require("react-app-rewire-alias");

const aliasMap = configPaths("./jsconfig.paths.json");
const aliasOverride = alias(aliasMap);

module.exports = function override(config, env) {
    config = aliasOverride(config, env);

    const oneOfRule = config.module.rules.find((rule) => rule.oneOf);
    if (oneOfRule) {
        oneOfRule.oneOf.unshift({
            test: /\.m?js$/,
            include: [path.resolve(__dirname, "proposition-bkt")],
            use: {
                loader: require.resolve("babel-loader"),
                options: {
                    presets: [require.resolve("babel-preset-react-app")],
                    cacheDirectory: true,
                },
            },
        });
    }

    return config;
};

module.exports.jest = aliasJest(aliasMap);
