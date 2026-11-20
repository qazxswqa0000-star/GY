window.initSocialLinks = function initSocialLinks() {
  const social = (window.YEAXMI_CONFIG || {}).SOCIAL_LINKS || {};
  document.querySelectorAll("[data-social-link]").forEach(element => {
    const key = element.dataset.socialLink;
    if (social[key]) {
      element.setAttribute("href", social[key]);
    }
  });
};
