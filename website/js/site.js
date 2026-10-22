(function () {
  var toggle = document.querySelector("[data-menu-open]");
  var slide = document.querySelector("[data-slide-nav]");
  var panel = slide ? slide.querySelector(".slide-nav__panel") : null;

  function setScrolled() {
    document.body.classList.toggle("is-scrolled", window.scrollY > 24);
  }

  setScrolled();
  window.addEventListener("scroll", setScrolled, { passive: true });

  function openMenu() {
    if (!slide || !toggle) return;
    slide.classList.add("is-open");
    slide.setAttribute("aria-hidden", "false");
    document.body.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
    var closeBtn = slide.querySelector(".slide-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeMenu() {
    if (!slide || !toggle) return;
    slide.classList.remove("is-open");
    slide.setAttribute("aria-hidden", "true");
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      if (slide.classList.contains("is-open")) closeMenu();
      else openMenu();
    });
  }

  document.querySelectorAll("[data-menu-close]").forEach(function (el) {
    el.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && slide && slide.classList.contains("is-open")) {
      closeMenu();
    }
    if (!slide || !slide.classList.contains("is-open") || event.key !== "Tab" || !panel) return;
    var focusable = panel.querySelectorAll("a[href], button:not([disabled])");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (page === "") page = "index.html";
  document.querySelectorAll("[data-nav-link]").forEach(function (link) {
    var href = (link.getAttribute("href") || "").split("#")[0].toLowerCase();
    if (href === page) link.setAttribute("aria-current", "page");
  });

  document.querySelectorAll("[data-slider]").forEach(function (slider) {
    var slides = Array.prototype.slice.call(slider.querySelectorAll(".slide"));
    var status = slider.parentElement.querySelector("[data-slider-status]");
    var index = 0;
    if (!slides.length) return;

    function show(next) {
      index = (next + slides.length) % slides.length;
      slides.forEach(function (slideEl, i) {
        slideEl.classList.toggle("is-active", i === index);
      });
      if (status) status.textContent = (index + 1) + " / " + slides.length;
    }

    var prev = slider.querySelector("[data-prev]");
    var next = slider.querySelector("[data-next]");
    if (prev) prev.addEventListener("click", function () { show(index - 1); });
    if (next) next.addEventListener("click", function () { show(index + 1); });
    slider.addEventListener("keydown", function (event) {
      if (event.key === "ArrowRight") show(index + 1);
      if (event.key === "ArrowLeft") show(index - 1);
    });
    show(0);
  });

  document.querySelectorAll("[data-form]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var fields = form.querySelector("[data-form-fields]");
      var success = form.querySelector("[data-success]");
      if (fields) fields.hidden = true;
      if (success) {
        success.hidden = false;
        var heading = success.querySelector("p, h3");
        if (heading) heading.focus && heading.setAttribute("tabindex", "-1");
        success.focus && success.setAttribute("tabindex", "-1");
        success.focus();
      }
    });
  });

  document.querySelectorAll("[data-clip]").forEach(function (clip) {
    var video = clip.querySelector("video");
    var button = clip.querySelector("[data-clip-play]");
    if (!video || !button) return;
    button.addEventListener("click", function () {
      if (video.paused) {
        video.play();
        button.hidden = true;
      }
    });
    video.addEventListener("pause", function () {
      button.hidden = false;
    });
    video.addEventListener("ended", function () {
      button.hidden = false;
    });
  });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("video[autoplay]").forEach(function (video) {
      video.removeAttribute("autoplay");
      video.pause();
    });
  }
})();
