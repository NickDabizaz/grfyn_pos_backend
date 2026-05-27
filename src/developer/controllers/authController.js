const devAuth = require('../middleware/devAuth');

exports.loginPage = (req, res) => {
  if (req.session && req.session.devAuthenticated) {
    return res.redirect('/developer');
  }
  res.render('login', { error: null, layout: false, title: 'Login', active: '' });
};

exports.login = async (req, res) => {
  const { username, password } = req.body;

  if (devAuth.validateLogin(username, password)) {
    req.session.devAuthenticated = true;
    req.session.devLoginTime = new Date();
    devAuth.setCookie(res, username);

    return req.session.save(() => res.redirect('/developer'));
  }

  res.render('login', {
    error: 'Username atau password salah',
    layout: false,
    title: 'Login',
    active: ''
  });
};

exports.logout = (req, res) => {
  devAuth.clearCookie(res);
  req.session.destroy(() => {
    res.redirect('/developer/login');
  });
};
