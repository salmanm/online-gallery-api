var path           = require('path');
var http           = require('http');
var express        = require('express');
var bodyParser     = require('body-parser');
var cookieParser   = require('cookie-parser');
var methodOverride = require('method-override');
var session        = require('express-session');
var serveStatic    = require('serve-static');
var argv           = require('optimist').argv;
var seneca         = require('seneca')();
var options        = seneca.options('config.mine.js');
var cors           = require('cors');
var multiparty     = require('multiparty');
var mv             = require('mv');
var uuid           = require('node-uuid');

seneca.use('mongo-store', {
  name: 'gallery',
  host: 'localhost',
  port: 27017
});

seneca.use('user');

seneca.use('auth', {
  redirect:{
    login: {
      win:  '/account',
      fail: '/login#failed'
    },
    register: {
      win:  '/account',
      fail: '/#failed'
    }
  }
});

var app = express();
app.enable('trust proxy');

app.use(cors());
app.use(cookieParser());
app.use(express.query());
app.use(bodyParser.urlencoded({extended: true}));
app.use(methodOverride());
app.use(bodyParser.json());

app.use(session({secret:'seneca'}));
app.use('/pictures', serveStatic('pictures'));
app.use(seneca.export('web'));

app.engine('ejs',require('ejs-locals'));
app.set('views', __dirname + '/views');
app.set('view engine','ejs');

app.get('/login', function(req, res) {
  res.render('login.ejs',{});
})

app.get('/account', function(req, res) {
  res.render('account.ejs',{locals:{user:req.seneca.user}});
})

var server = http.createServer(app);
server.listen(options.main ? options.main.port : 3000);

seneca.use('data-editor');
seneca.use('admin', {server: server});

seneca.add({role: 'gallery', cmd: 'fetch'}, function(args, callback) {
  var user_id = args.user_id;
	
	var sys_login = seneca.make$('pictures');
	sys_login.list$({"user_id": user_id}, function(err, pictures) {
		if (err) {
			console.log(err);
		}
		callback(null, pictures);	
	});
});

seneca.add({role: 'user', cmd: 'get'}, function(args, callback) {
  var token = args.token;
	var sys_login = seneca.make$('sys_login');
	sys_login.load$({"token": token}, function(err, user) {
		if (err) {
			console.log(err);
		}
		
		callback(null, user);	
	});
	
});

function userAuth(req, res, next) {
	var token = req.headers['x-api-key'];

	if (!token) {
		res.status(403).send({});
	} else {
		seneca.act({role: 'user', cmd: 'get', token: token}, function(err, user) {
			if (err) {
				return console.error(err);
			}
			
			if (user) {
				req.user = user;
				console.log('User authenticated');
				next();
			} else {
				console.log('User bad');
				req.user = {};
				res.status(403).send({});
			}
		});
	}
};

app.get('/gallery/', userAuth, function(req, res) {
	var token = req.user.token;
	var user_id = req.user.user;

  seneca.act({role: 'gallery', cmd: 'fetch', user_id: user_id}, function(err, data) {
		if (err) {
			return console.error(err);
		}

		res.send(data);
	})
});

app.post('/gallery/', userAuth, function(req, res) {
	var token = req.user.token;
	var user_id = req.user.user;
	var form = new multiparty.Form();

	form.parse(req, function(err, fields, files) {
		var image = files.picture[0];
		
		var orig_picture_name = image.originalFilename;
		var file_name = uuid.v4();
		var ext = path.extname(orig_picture_name);
		var picture_name = path.basename(orig_picture_name, ext);
		
		mv(image.path, './pictures/' + file_name + ext, function(err) {
			if (err) {
				console.log(err);
			}
			
			var pic = seneca.make$('pictures');
			pic.orig_picture_name = orig_picture_name;
			pic.picture_name = picture_name;
			pic.file_name = file_name;
			pic.ext = ext;
			pic.user_id = user_id;
			pic.size = image.size;
			pic.upload_date = new Date();
			
			pic.save$(function(err, pictures){
				if (err) {
					console.log(err);
				}
				
				console.log(pictures);
			});

			
			res.send({'done': 1});
		});
	});
})