(function() {
  var expiry = localStorage.getItem("ap_auth");
  if (!expiry || Date.now() > Number(expiry)) {
    localStorage.removeItem("ap_auth");
    window.location.replace("/v2");
  }
})();
