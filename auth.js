(function() {
  if (sessionStorage.getItem("ap_auth") !== "1") {
    window.location.replace("index.html");
  }
})();
