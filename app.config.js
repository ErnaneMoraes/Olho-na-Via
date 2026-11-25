module.exports = ({ config }) => {
  const isGitHubPages = process.env.GITHUB_PAGES === 'true';
  const rawBaseUrl = process.env.GITHUB_PAGES_BASE_URL || '/Olho-na-Via';
  const normalizedBaseUrl = rawBaseUrl.startsWith('/') ? rawBaseUrl : `/${rawBaseUrl}`;

  if (!isGitHubPages) {
    return config;
  }

  return {
    ...config,
    experiments: {
      ...(config.experiments || {}),
      baseUrl: normalizedBaseUrl,
    },
  };
};
