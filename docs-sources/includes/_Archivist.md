# Archivist

Archivist is a key-value abstraction layer generally used with state objects.

The player module created through the previous sections already uses Archivist
to store data on the local file system; more specifically, the auth module used
in the [Actors & Sessions](./index.html#actors-sessions) section of this user guide
uses Archivist behind the scenes to store credentials for newly created users.

## Vaults

> ./config/default.yaml

```yaml
archivist:
    vaults:
        userVault:
            type: file
            config:
                path: ./filevault/userVault
        itemVault:
            type: file
            config:
                path: ./filevault/itemVault
```

<aside class="warning">
Not all vaults support all operations! Please refer to the
[Vault API documentation](./api.html#file-vault) for more details.
</aside>

As mentioned, vaults are used by archivist to store data. Currently, the following backend
targets are supported:

| Backend               | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| file                  | Store data to the local disk, in JSON files.                 |
| memory                | Keep data in memory (does not persist).                      |
| client                | Special vault type (client-side archivist support required). |
| couchbase             | [Couchbase](https://www.couchbase.com/) interface            |
| mysql                 | [MySQL](https://www.mysql.com/) interface.                   |
| elasticsearch         | [Elasticsearch](https://www.elastic.co/) interface.          |
| dynamodb              | [AWS DynamoDB](https://aws.amazon.com/dynamodb/) interface.  |
| manta                 | [Joyent Manta](https://apidocs.joyent.com/manta/) interface. |
| redis                 | [Redis](https://redis.io/) interface.                        |
| memcached             | [Memcached](https://memcached.org/) interface.               |

Vaults can have different configuration for different environments, as long as the Archivist
API set used in your project is provided by the different vault backends you wish to use.

## Topics

> lib/archivist/index.js

```javascript
exports.player = {
  index: ['userId'],
  vaults: {
    userVault: {}
  }
};
```

Topics are essentially Archivist datatypes; they define which vault(s)
to use for storage, the key structure for accessing data, and so on.

In this example, we simply specify a new topic, called items, in which we will be
identifying by itemId.

## Store & retrieve topics

> lib/modules/players/index.js

```javascript
exports.create = function (state, userId, playerData) {
  state.archivist.set('player', { userId: userId }, playerData);
};

exports.list = function (state, callback) {
  var topic = 'player';
  var partialIndex = {};

  state.archivist.list(topic, partialIndex, function (error, indexes) {
    if (error) {
      return callback(error);
    }

    var queries = indexes.map(function (index) {
      return { topic: topic, index: index };
    });

    state.archivist.mget(queries, callback);
  });
};
```

> lib/modules/players/usercommands/register.js

```javascript
var mage = require('mage');
exports.acl = ['*'];
exports.execute = function (state, username, password, callback) {
  mage.players.register(state, username, password, function (error, userId) {
    if (error) {
      return state.error(error.code, error, callback);
    }

    mage.players.create(state, userId, {
      coins: 10,
      level: 1,
      tutorialCompleted: false
    });

    state.respond(userId);

    return callback();
  });
};
```

> lib/modules/players/usercommands/list.js

```javascript
var mage = require('mage')
exports.acl = ['*'];
exports.execute = function (state, callback) {
  mage.players.list(state, function (error, players) {
    // We ignore the error for brievety's sake
    state.respond(players);
    callback();
  });
};
```

Again, in this example we are leaving the ACL permissions entirely open so that you may
try to manually access them; in the real world, however, you would need to make sure to
put the right permissions in here.

In this example, we augment the players module we have previously created with two
methods: `create`, and `list`. In each method, we use `state.archivist` to retrieve
and store data. We then modify the `players.register` user command, and have it create
the player's data upon successful registration. Finally, we add a new user command
called `players.list`, which will let us see a list of all players' data.

You may notice that `players.list` actually calls two functions: `state.archivist.list` and
`state.archivist.mget`; this is because `list` will return a list of indexes, which we
then feed into `mget` (remember, Archivist works with key-value).

You may also notice that while `state.archivist.list` is asynchronous (it requires a callback
function), `state.archivist.set` is not; because states act as transactions, writes
are not executed against your backend storage until the transaction is completed, thus
making write operations synchronous. This will generally be true of all `state.archivist`
APIs; reads will be asynchronous, but writes will be synchronous.

## Testing storage

```shell
curl -X POST http://127.0.0.1:8080/game/players.list \
--data-binary @- << EOF
[]
{}
EOF
```

```powershell
 Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8080/game/players.list" -Body '[]
{}'
```

We can re-use the previous command to create a new user; once we have done so, we can use
the following command to retrieve the data we have just created.

## Key-based filtering

> lib/archivist/index.js

```javascript
exports.item = {
  index: ['userId', 'itemId'],
  vaults: {
    itemVault: {}
  }
};
```

> lib/modules/items/index.js

```javascript
exports.getItemsForUser = function (state, userId, callback) {
  var topic = 'item';
  var partialIndex = { userId: userId };

  state.archivist.list(topic, partialIndex, function (error, indexes) {
    if (error) {
      return callback(error);
    }

    var queries = indexes.map(function (index) {
      return { topic: topic, index: index };
    });

    state.archivist.mget(queries, callback);
  });
};
```

There are a few ways by which you can split and filter the data
stored in your topics.

In this example, we have an `item` topic with an index of two fields: `userId` and `itemId`.
When a topic index has more than one field, we can use the `partialKey` on a `state.archivist.list`
call to filter the list of keys to return. In the sample code here, we use this
feature to return all items' full keys for a given user.

## Limiting access

> lib/archivist/index.js

```javascript
exports.item = {
  index: ['userId', 'itemId'],
  vaults: {
    client: {
      shard: function (value) {
        return value.index.userId;
      },
      acl: function (test) {
        test(['user', 'test'], 'get', { shard: true });
        test(['cms', 'admin'], '*');
      }
    },
    inventoryVault: {}
  }
};
```

In most cases, you will want to make sure that a given user will
only be able to access data they have the permission to access.

There are primarily two ways to limit access to topics:

  * **shard function**: used to filter what data can be viewed;
  * **acl function**: used to determine if the data can be accessed;

In this example, we use the shard function to limit returned data
to only data which matches the userId.

We then use the acl function to only allow users and tests access to
the `get` API, but full access to CMS users and administrators.
