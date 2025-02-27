/*
  ztncui - ZeroTier network controller UI
  Copyright (C) 2017-2021  Key Networks (https://key-networks.com)
  Licensed under GPLv3 - see LICENSE for details.
*/

const argon2 = require('argon2');
const usersController = require('../controllers/usersController');

const hash_check = async function(user, password) {
  let verified = false;
  try {
    var users = await usersController.get_users();
  } catch (err) {
    throw err;
  }
  try {
    verified = await argon2.verify(users[user].hash, password);
  } catch (err) {
    throw err;
  }
  return verified;
}

exports.authenticate = async function(name, pass, callback) {
  try {
    var users = await usersController.get_users();
  } catch (err) {
    throw err;
  }
  let user = users[name];
  if (!user) return callback(new Error('找不到用户'));
  let verified = await hash_check(name, pass);
  if (verified) {
    return callback(null, user);
  } else {
    return callback(new Error('密码错误'));
  }
}

exports.restrict = function(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    req.session.error = '认证失败!';
    res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
}
