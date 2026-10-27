(() => {
  const adSlots = [...document.querySelectorAll("ins.adsbygoogle[data-ad-slot]")];
  if (adSlots.length === 0) return;

  const publisherId = "ca-pub-9721915487009186";
  const loaderUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
  const adsbygoogle = window.adsbygoogle = window.adsbygoogle || [];

  const requestAd = (slot) => {
    if (slot.dataset.adsRequested === "true") return;
    slot.dataset.adsRequested = "true";
    adsbygoogle.push({});
  };

  for (const slot of adSlots) {
    const minWidth = slot.closest("[data-ad-min-width]")?.dataset.adMinWidth;
    if (!minWidth) {
      requestAd(slot);
      continue;
    }

    const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`);
    if (mediaQuery.matches) {
      requestAd(slot);
    } else {
      const requestWhenVisible = (event) => {
        if (!event.matches) return;
        mediaQuery.removeEventListener("change", requestWhenVisible);
        requestAd(slot);
      };
      mediaQuery.addEventListener("change", requestWhenVisible);
    }
  }

  if (!document.querySelector(`script[src^="${loaderUrl}"]`)) {
    const loader = document.createElement("script");
    loader.async = true;
    loader.crossOrigin = "anonymous";
    loader.src = loaderUrl;
    document.head.append(loader);
  }
})();
