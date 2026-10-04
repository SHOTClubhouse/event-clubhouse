// Product site enhancements. Vanilla, no dependencies. The page works without this file;
// it only loads the live previews and scales the big-screen preview to its frame.

(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const embeds = Array.from(document.querySelectorAll("[data-embed]"));

  function show(box, text, canLoad) {
    const msg = box.querySelector("[data-msg]");
    const btn = box.querySelector("[data-load]");
    if (msg) msg.textContent = text;
    if (btn) btn.hidden = !canLoad;
  }

  // The preview is only worth showing if the event exists on this server.
  async function exists(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  async function load(box) {
    if (box.dataset.state) return;
    box.dataset.state = "loading";
    show(box, "Loading the live preview.", false);
    if (!(await exists(box.dataset.check))) {
      box.dataset.state = "failed";
      show(box, "The live preview is not available right now. You can still open it full size.", false);
      return;
    }
    const frame = document.createElement("iframe");
    frame.className = "ecs-embed-frame";
    frame.title = box.dataset.title;
    frame.loading = "lazy";
    frame.setAttribute("referrerpolicy", "same-origin");
    const timer = setTimeout(() => {
      if (box.dataset.state === "loading") show(box, "This is taking a while. You can open it full size instead.", false);
    }, 8000);
    frame.addEventListener("load", () => {
      clearTimeout(timer);
      box.dataset.state = "loaded";
      box.classList.add("is-loaded");
    });
    frame.src = box.dataset.src;
    box.appendChild(frame);
  }

  function wanted(box) {
    const min = Number(box.dataset.min || 0);
    if (reduce) return "Motion is reduced on this device, so the preview waits for you.";
    if (min && window.innerWidth < min) return "The screen preview is hidden on small screens to keep this page quick.";
    return "";
  }

  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          load(e.target);
        });
      }, { rootMargin: "300px" })
    : null;

  embeds.forEach((box) => {
    const why = wanted(box);
    const btn = box.querySelector("[data-load]");
    if (btn) btn.addEventListener("click", () => { box.dataset.state = ""; load(box); });
    if (why) { show(box, why, true); return; }
    if (io) io.observe(box); else load(box);
  });

  // The big screen preview renders at 1280 x 720 and is scaled to whatever room the frame has.
  const tv = document.querySelector(".ecs-tv-screen");
  if (tv && "ResizeObserver" in window) {
    new ResizeObserver(() => tv.style.setProperty("--s", String(tv.clientWidth / 1280))).observe(tv);
  }
})();
