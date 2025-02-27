/*
  ztncui - ZeroTier network controller UI
  Copyright (C) 2017-2021  Key Networks (https://key-networks.com)
  Licensed under GPLv3 - see LICENSE for details.
*/

const fs = require('fs');
const ipaddr = require('ip-address');
const storage = require('node-persist');
const zt = require('./zt');
const util = require('util');

storage.initSync({dir: 'etc/storage'});

async function get_network_with_members(nwid) {
  const [network, peers, members] = await Promise.all([
    zt.network_detail(nwid),
    zt.peers(),
    zt.members(nwid)
      .then(member_ids =>
        Promise.all(
          Object.keys(member_ids)
            .map(id => Promise.all([
              zt.member_detail(nwid, id),
              storage.getItem(id)
            ]))
        )
      ).then(results => results.map(([member, name]) => {
        member.name = name || '';
        return member;
      }))
  ]);
  for (const member of members) {
    member.peer = peers.find(x => x.address === member.address);
  }
  return {network, members};
}

async function get_network_member(nwid, memberid) {
  const [network, member, peer, name] = await Promise.all([
    zt.network_detail(nwid),
    zt.member_detail(nwid, memberid),
    zt.peer(memberid),
    storage.getItem(memberid)
  ]);
  member.name = name || '';
  member.peer = peer;
  return {network, member};
}

// ZT network controller home page
exports.index = async function(req, res) {
  const navigate =
    {
      active: 'controller_home',
    }

  try {
    const zt_status = await zt.get_zt_status();
    res.render('index', {title: 'ztncui控制器', navigate: navigate, zt_status});
  } catch (err) {
    res.render('index', {title: 'ztncui控制器',
                      navigate: navigate, error: '获取 ZT 状态时出错: ' + err});
  }
};

// Display list of all networks on this ZT network controller
exports.network_list = async function(req, res) {
  const navigate =
    {
      active: 'networks',
    }

  try {
    networks = await zt.network_list();
    res.render('networks', {title: '此控制器上的网络', navigate: navigate, networks: networks});
  } catch (err) {
    res.render('networks', {title: '此控制器上的网络', navigate: navigate, error: '检索此控制器上的网络列表时出错: ' + err});
  }
};

// Display detail page for specific network
exports.network_detail = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  try {
    const [
      {network, members},
      zt_address
    ] = await Promise.all([
      get_network_with_members(req.params.nwid),
      zt.get_zt_address()
    ]);
    res.render('network_detail', {title: '网络 ' + network.name, navigate: navigate, network: network, members: members, zt_address: zt_address});
  } catch (err) {
    res.render('network_detail', {title: '网络详细信息', navigate: navigate, error: '解析网络的详细信息时出错 ' + req.params.nwid + ': ' + err});
  }
};

// Display Network create form on GET
exports.network_create_get = function(req, res) {
  const navigate =
    {
      active: 'add_network',
    }

  res.render('network_create', {title: '创建网络', navigate: navigate});
};

// Handle Network create on POST
exports.network_create_post = async function(req, res) {
  const navigate =
    {
      active: 'add_network',
    }

  req.checkBody('name', '网络名称必填').notEmpty();

  req.sanitize('name').escape();
  req.sanitize('name').trim();

  const errors = req.validationErrors();

  let name = { name: req.body.name };

  if (errors) {
    res.render('network_create', {title: '创建网络', navigate: navigate, name: name, errors: errors});
    return;
  } else {
    try {
      const network = await zt.network_create(name);
      res.redirect('/controller/network/' + network.nwid);
    } catch (err) {
      res.render('network_detail', {title: '创建网络 - 错误', navigate: navigate, error: '创建网络时出错 ' + name.name});
    }
  }
};

// Display Network delete form on GET
exports.network_delete_get = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
    res.render('network_delete', {title: '删除网络', navigate: navigate,
                                    nwid: req.params.nwid, network: network});
  } catch (err) {
    res.render('network_delete', {title: '删除网络', navigate: navigate, error: '解析网络时出错 ' + req.params.nwid + ': ' + err});
  }
};

// Handle Network delete on POST
exports.network_delete_post = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  try {
    const network = await zt.network_delete(req.params.nwid);
    res.render('network_delete', {title: '删除网络', navigate: navigate, network: network});
  } catch (err) {
    res.render('network_delete', {title: '删除网络', navigate: navigate, error: '删除网络时候出错 ' + req.params.nwid + ': ' + err});
  }
};

// Network object GET
exports.network_object = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render(req.params.object, {title: req.params.object, navigate: navigate, network: network}, function(err, html) {
      if (err) {
        if (err.message.indexOf('Failed to lookup view') !== -1 ) {
          return res.render('not_implemented', {title: req.params.object, navigate: navigate, network: network});
        }
        throw err;
      }
      res.send(html);
    });
  } catch (err) {
    res.render(req.params.object, {title: req.params.object, navigate: navigate, error: '解析网络的详细信息时出错 ' + req.params.nwid + ': ' + err});
  }
}

// Handle Network rename form on POST
exports.name = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  req.checkBody('name', '网络名称必填').notEmpty();
  req.sanitize('name').escape();
  req.sanitize('name').trim();

  const errors = req.validationErrors();

  let name = { name: req.body.name };

  if (errors) {
    console.error("网络名称验证错误", errors);
  } else {
    try {
      const network = await zt.network_object(req.params.nwid, name);
    } catch ( err) {
      console.error("重命名网络时出错 " + req.params.nwid, err);
    }
  }
  res.redirect('/controller/network/' + req.params.nwid);
};

// ipAssignmentPools POST
exports.ipAssignmentPools = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

    req.checkBody('ipRangeStart', '需要IP起始地址').notEmpty();
    req.checkBody('ipRangeStart', 'IP起始地址需要有效的IPv4或IPv6地址').isIP();
    req.sanitize('ipRangeStart').escape();
    req.sanitize('ipRangeStart').trim();
    req.checkBody('ipRangeEnd', '需要IP结束地址').notEmpty();
    req.checkBody('ipRangeEnd', 'IP结束地址需要有效的IPv4或IPv6地址').isIP();
    req.sanitize('ipRangEnd').escape();
    req.sanitize('ipRangEnd').trim();

  const errors = req.validationErrors();

  const ipAssignmentPool =
    {
      ipRangeStart: req.body.ipRangeStart,
      ipRangeEnd: req.body.ipRangeEnd
    };

  if (errors) {
    try {
      const network = await zt.network_detail(req.params.nwid);
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('ipAssignmentPools', {title: 'ip分配池', navigate: navigate, ipAssignmentPool: ipAssignmentPool, network: network, errors: errors});
    } catch (err) {
      res.render('ipAssignmentPools', {title: 'ip分配池', navigate: navigate, error: '解析网络的网络详细信息时出错 ' + req.params.nwid + ': ' + err});
    }
  } else {
    try {
      const network = await zt.ipAssignmentPools(req.params.nwid, ipAssignmentPool, 'add');
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('ipAssignmentPools', {title: 'ip分配池', navigate: navigate, ipAssignmentPool: ipAssignmentPool, network: network});
    } catch (err) {
      res.render('ipAssignmentPools', {title: 'ip分配池', navigate: navigate, error: '应用ip分配池时出错 ' + req.params.nwid + ': ' + err});
    }
  }
}

isValidPrefix = function(str, max) {
  const num = Math.floor(Number(str));
  return String(num) == str && num >= 0 && num <= max;
}

// routes POST
exports.routes = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  req.checkBody('target', '目标网络必填').notEmpty();
  req.sanitize('target').trim();
  req.checkBody('target', '目标网络必须是有效的CIDR格式')
    .custom(value => {
      const parts = value.split('/');
      const ipv4 = new ipaddr.Address4(parts[0]);
      const ipv6 = new ipaddr.Address6(parts[0]);
      let isValidIPv4orIPv6 = false;
      let prefixMax = 32;
      if (ipv4.isValid()) {
        isValidIPv4orIPv6 = true;
      } else {
      }
      if (ipv6.isValid()) {
        isValidIPv4orIPv6 = true;
        prefixMax = 128;
      } else {
      }
      return isValidIPv4orIPv6 && isValidPrefix(parts[1], prefixMax);
    });
  req.checkBody('via', '网关必须是有效的IPv4或IPv6地址').optional({ checkFalsy: true }).isIP();
  req.sanitize('via').escape();
  req.sanitize('via').trim();
  if (! req.body.via) {
    req.body.via = null;
  }

  const errors = req.validationErrors();

  const route =
    {
      target: req.body.target,
      via: req.body.via
    };

  if (errors) {
    try {
      const network = await zt.network_detail(req.params.nwid);
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('routes', {title: '路由', navigate: navigate, route: route, network: network, errors: errors});
    } catch (err) {
      res.render('routes', {title: '路由', navigate: navigate, error: '解析网络详细信息时出错'});
    }
  } else {
    try {
      const network = await zt.routes(req.params.nwid, route, 'add');
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('routes', {title: '路由', navigate: navigate, route: route, network: network});
    } catch (err) {
      res.render('routes', {title: '路由', navigate: navigate, error: '为网络添加路由时出错 ' + req.params.nwid + ': ' + err});
    }
  }

}

// route_delete GET
exports.route_delete = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const route =
    {
      target: req.params.target_ip + '/' + req.params.target_prefix,
      via: null
    };


  try {
    const network = await zt.routes(req.params.nwid, route, 'delete');
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('routes', {title: '路由', navigate: navigate, route: route, network: network});
  } catch (err) {
    res.render('routes', {title: '路由', navigate: navigate, error: '删除网络的路由时出错 ' + req.params.nwid + ': ' + err});
  }
}

// ipAssignmentPool_delete GET
exports.ipAssignmentPool_delete = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const ipAssignmentPool =
    {
      ipRangeStart: req.params.ipRangeStart,
      ipRangeEnd: req.params.ipRangeEnd
    };


  try {
    const network = await zt.ipAssignmentPools(req.params.nwid, ipAssignmentPool, 'delete');
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('ipAssignmentPools', {title: 'ip分配池', navigate: navigate, ipAssignmentPool: ipAssignmentPool, network: network});
  } catch (err) {
    res.render('ipAssignmentPools', {title: 'ip分配池', navigate: navigate, error: '删除网络的IP分配池时出错 ' + req.params.nwid + ': ' + err});
  }
}

// private POST
exports.private = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const private =
    {
      private: req.body.private
    };

  try {
    const network = await zt.network_object(req.params.nwid, private);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('private', {title: '私有', navigate: navigate, network: network});
  } catch (err) {
    res.render('private', {title: '私有', navigate: navigate, error: '应用专用网络时出错 ' + req.params.nwid + ': ' + err});
  }
}

// v4AssignMode POST
exports.v4AssignMode = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const v4AssignMode =
    {
      v4AssignMode: { zt: req.body.zt }
    };

  try {
    const network = await zt.network_object(req.params.nwid, v4AssignMode);
    navigate.whence = '/controller/network/' + network.nwid;
      res.render('v4AssignMode', {title: 'V4分配模式', navigate: navigate, network: network});
  } catch (err) {
      res.render('v4AssignMode', {title: 'V4分配模式', navigate: navigate, error: '为网络应用V4分配模式时出错 ' + req.params.nwid + ': ' + err});
  }
}

// v6AssignMode POST
exports.v6AssignMode = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const v6AssignMode =
    {
      v6AssignMode:
        {
          '6plane': req.body['6plane'],
          'rfc4193': req.body.rfc4193,
          'zt': req.body.zt
        }
    };

  try {
    const network = await zt.network_object(req.params.nwid, v6AssignMode);
    navigate.whence = '/controller/network/' + network.nwid;
      res.render('v6AssignMode', {title: 'V6分配模式', navigate: navigate, network: network});
  } catch (err) {
      res.render('v6AssignMode', {title: 'V6分配模式', navigate: navigate, error: '为网络应用V6分配模式时出错 ' + req.params.nwid + ': ' + err});
  }
}

// dns POST
exports.dns = async function (req, res) {
  const navigate = {
    active: 'networks',
    whence: ''
  };

  const dns = {
    dns: {
      domain: req.body.domain,
      servers: req.body.servers
        .split('\n')
        .map(x => x.trim())
        .filter(ip =>
          new ipaddr.Address4(ip).isValid() ||
          new ipaddr.Address6(ip).isValid()
        )
    }
  };

  try {
    const network = await zt.network_object(req.params.nwid, dns);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('dns', {title: 'dns', navigate: navigate, network: network});
  } catch (err) {
      res.render('dns', {title: 'dns', navigate: navigate, error: '更新网络的dns时出错 ' + req.params.nwid + ': ' + err});
  }
}

// Display detail page for specific member
exports.member_detail = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const {network, member} = await get_network_member(req.params.nwid, req.params.id);
    navigate.whence = '/controller/network/' + network.nwid + '#members';
      res.render('member_detail', {title: '网络成员详细信息', navigate: navigate, network: network, member: member});
  } catch (err) {
    console.error(err);
      res.render('error', {title: req.params.object, navigate: navigate, error: '解析成员的详细信息时出错 ' + req.params.id + ' 从网络 ' + req.params.nwid + ': ' + err});
  }
};

// Member object GET
exports.member_object = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const {network, member} = await get_network_member(req.params.nwid, req.params.id);
    navigate.whence = '/controller/network/' + network.nwid + '#members';
    res.render(req.params.object, {title: req.params.object, navigate: navigate, network: network, member: member}, function(err, html) {
      if (err) {
        if (err.message.indexOf('Failed to lookup view') !== -1 ) {
          return res.render('not_implemented', {title: req.params.object, navigate: navigate, network: network, member: member});
        }
        throw err;
      }
      res.send(html);
    });
  } catch (err) {
      res.render(req.params.object, {title: req.params.object, navigate: navigate, error: '解析成员的详细信息时出错 ' + req.params.id + ' 从网络 ' + req.params.nwid + ': ' + err});
  }
}

// Easy network setup GET
exports.easy_get = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/network/' + req.params.nwid
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
      res.render('network_easy', {title: '网络的简易设置', navigate: navigate, network: network});
  } catch (err) {
      res.render('network_easy', {title: '网络的简易设置', navigate: navigate, error: '解析网络的详细信息时出错 ' + req.params.nwid + ': ' + err});
  }
}

// Easy network setup POST
exports.easy_post = async function(req, res) {
    const navigate =
        {
            active: 'networks',
            whence: '/controller/networks'
        }

    req.checkBody('networkCIDR', '网络地址是必需的').notEmpty();
    req.sanitize('networkCIDR').trim();
    req.checkBody('networkCIDR', '网络地址必须使用CIDR表示法')
        .custom(value => {
            const parts = value.split('/');
            const ipv4 = new ipaddr.Address4(parts[0]);
            return ipv4.isValid() && isValidPrefix(parts[1], 32);
        });
    req.checkBody('poolStart', 'ip分配池起始地址是必需的')
        .notEmpty();
    req.checkBody('poolStart', 'ip分配池起始地址必须是有效的IPv4地址')
        .isIP(4);
    req.sanitize('poolStart').escape();
    req.sanitize('poolStart').trim();
    req.checkBody('poolEnd', 'ip分配池结束地址是必需的')
        .notEmpty();
    req.checkBody('poolEnd', 'ip分配池结束地址必须是有效的IPv4地址')
        .isIP(4);
    req.sanitize('poolEnd').escape();
    req.sanitize('poolEnd').trim();

    const errors = req.validationErrors();

    const ipAssignmentPools =
        [{
            ipRangeStart: req.body.poolStart,
            ipRangeEnd: req.body.poolEnd
        }];

    const routes =
        [{
            target: req.body.networkCIDR,
            via: null
        }];

    const v4AssignMode =
        {
            zt: true
        };

    if (errors) {
        network =
            {
                ipAssignmentPools: ipAssignmentPools,
                routes: routes,
                v4AssignMode: v4AssignMode
            };

        res.render('network_easy', {title: '网络的简易设置', navigate: navigate, network: network, errors: errors});
    } else {
        try {
            const network = await zt.network_easy_setup(req.params.nwid,
                routes,
                ipAssignmentPools,
                v4AssignMode);
            res.render('network_easy', {title: '网络的简易设置', navigate: navigate, network: network, message: 'Network setup succeeded'});
        } catch (err) {
            res.render('network_easy', {title: '网络的简易设置', navigate: navigate, error: '解析网络的详细信息时出错 ' + req.params.nwid + ': ' + err});
        }
    }
}

// Easy members auth POST
exports.members = async function(req, res) {
    const navigate =
        {
            active: 'networks',
            whence: '/controller/networks'
        }

    let errors = null;

    if (req.method === 'POST') {

        req.checkBody('id', '成员ID是必需的').notEmpty();
        req.sanitize('id').trim();
        req.sanitize('id').escape();

        if (req.body.auth) {
            req.checkBody('auth', '授权状态必须为布尔值').isBoolean();
            req.sanitize('auth').trim();
            req.sanitize('auth').escape();

            errors = req.validationErrors();

            if (!errors) {
                const auth =
                    {
                        authorized: req.body.auth
                    };

                try {
                    const mem = await zt.member_object(req.params.nwid, req.body.id, auth);
                } catch (err) {
                    throw err;
                }
            }
        } else if (req.body.activeBridge) {
            req.checkBody('activeBridge', '活动网桥状态必须为布尔值').isBoolean();
            req.sanitize('activeBridge').trim();
            req.sanitize('activeBridge').escape();

            errors = req.validationErrors();

            if (!errors) {
                const activeBridge =
                    {
                        activeBridge: req.body.activeBridge
                    };

                try {
                    const mem = await zt.member_object(req.params.nwid, req.body.id, activeBridge);
                } catch (err) {
                    throw err;
                }
            }
        } else if (req.body.name) {
            req.sanitize('name').trim();
            req.sanitize('name').escape();

            errors = req.validationErrors();

            if (!errors) {
                try {
                    const ret = await storage.setItem(req.body.id, req.body.name);
                } catch (err) {
                    throw err;
                }
            }
        }
    } else { // GET
        res.redirect("/controller/network/" + req.params.nwid + "#members");
    }
}

// Member delete GET or POST
exports.member_delete = async function(req, res) {
    const navigate =
        {
            active: 'networks',
            whence: ''
        }

    try {
        const network = await zt.network_detail(req.params.nwid);
        let member = null;
        let name = null;
        if (req.method === 'POST') {
            member = await zt.member_delete(req.params.nwid, req.params.id);
            if (member.deleted) {
                name = await storage.removeItem(member.id);
            }
        } else {
            member = await zt.member_detail(req.params.nwid, req.params.id);
            name = await storage.getItem(member.id);
        }
        member.name = name || '';

        navigate.whence = '/controller/network/' + network.nwid;
        res.render('member_delete', {title: '删除成员从 ' + network.name,
            navigate: navigate, network: network, member: member});
    } catch (err) {
        res.render('member_delete', {title: '从网络中删除成员', navigate: navigate,
            error: '解析成员的详细信息时出错 ' + req.params.id
                + ' 从网络 ' + req.params.nwid + ': ' + err});
    }
}

// ipAssignment delete GET
exports.delete_ip = async function(req, res) {
    const navigate =
        {
            active: 'networks',
            whence: ''
        }

    try {
        const network = await zt.network_detail(req.params.nwid);
        let member = await zt.member_detail(req.params.nwid, req.params.id);
        navigate.whence = '/controller/network/' + network.nwid;
        member.name = await storage.getItem(member.id) | '';
        if (req.params.index) {
            member = await zt.ipAssignmentDelete(network.nwid, member.id,
                req.params.index);
            res.redirect('/controller/network/' + network.nwid + '/member/' +
                member.id + '/ipAssignments');
        }
        res.render('ipAssignments', {title: 'ip分配 ' + network.name,
            navigate: navigate, index: req.params.index, network: network, member: member});
    } catch (err) {
        res.render('ipAssignments', {title: 'ip分配', navigate: navigate,
            error: '解析成员的详细信息时出错 ' + req.params.id
                + ' 从网络 ' + req.params.nwid + ': ' + err});
    }
}

// ipAssignments POST
exports.assign_ip = async function(req, res) {
    const navigate =
        {
            active: 'networks',
            whence: ''
        }

    try {
        var network = await zt.network_detail(req.params.nwid);
    } catch (err) {
        throw err;
    }

    req.checkBody('ipAddress', '需要IP地址').notEmpty();
    req.checkBody('ipAddress', 'IP地址必须是有效的IPv4或IPv6地址').isIP();
    req.checkBody('ipAddress', 'IP地址必须位于托管路由内')
        .custom(value => {
            let ipAddressInManagedRoute = false;
            network.routes.forEach(function(item) {
                let ipv4 = new ipaddr.Address4(value);
                let target4 = new ipaddr.Address4(item.target);
                if (ipv4.isValid() && target4.isValid()) {
                    if (ipv4.isInSubnet(target4)) ipAddressInManagedRoute =  true;
                }
                let ipv6 = new ipaddr.Address6(value);
                let target6 = new ipaddr.Address6(item.target);
                if (ipv6.isValid() && target6.isValid()) {
                    if (ipv6.isInSubnet(target6)) ipAddressInManagedRoute =  true;
                }
            });
            return ipAddressInManagedRoute;
        });
    req.sanitize('ipAddress').escape();
    req.sanitize('ipAddress').trim();

    const errors = req.validationErrors();

    const ipAssignment = { ipAddress: req.body.ipAddress };

    try {
        let member = await zt.member_detail(req.params.nwid, req.params.id);
        navigate.whence = '/controller/network/' + network.nwid;

        if (!errors) {
            member = await zt.ipAssignmentAdd(network.nwid, member.id, ipAssignment);
        }

        member.name = await storage.getItem(member.id) | '';

        res.render('ipAssignments', {title: 'ip分配', navigate: navigate,
            ipAssignment: ipAssignment, network: network, member: member,
            errors: errors});
    } catch (err) {
        res.render('ipAssignments', {title: 'ip分配', navigate: navigate,
            error: '解析成员的详细信息时出错 ' + req.params.id
                + ' 从网络 ' + req.params.nwid + ': ' + err});
    }
}
