/*!
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*global exports:true*/

(function () {
    'use strict';

    var escope,
        estraverse,
        esutils,
        utility,
        version,
        assert,
        Syntax,
        Map;

    escope = require('escope');
    estraverse = require('estraverse');
    esutils = require('esutils');
    utility = require('./utility');
    Map = require('./map');
    version = require('../package.json').version;

    Syntax = estraverse.Syntax;

    assert = function assert(cond, message) {
        if (!cond) {
            throw new Error(message);
        }
    };

    if (version.indexOf('-dev', version.length - 4) === -1) {
        assert = function () { };
    }

    function NameGenerator(scope, options) {
        this._scope = scope;
        this._functionName = '';
        if (!options.distinguishFunctionExpressionScope &&
                this._scope.upper &&
                this._scope.upper.functionExpressionScope) {
            this._functionName = this._scope.upper.block.id.name;
        }
    }

    NameGenerator.prototype.passAsUnique = function passAsUnique(name) {
        var i, iz;
        if (this._functionName === name) {
            return false;
        }
        if (esutils.keyword.isKeywordES5(name, true) || esutils.keyword.isRestrictedWord(name)) {
            return false;
        }
        if (this._scope.taints.has(name)) {
            return false;
        }
        for (i = 0, iz = this._scope.through.length; i < iz; ++i) {
            if (this._scope.through[i].identifier.name === name) {
                return false;
            }
        }

        if (this._scope.type === 'for' &&
            this._scope.variableScope.__id_map__ &&
            this._scope.variableScope.__id_map__[name]
        ) {
            return false;
        }
        return true;
    };

    NameGenerator.prototype.generateName = function generateName(tip) {
        do {
            tip = utility.generateNextName(tip);
        } while (!this.passAsUnique(tip));
        return tip;
    };

    function run(scope, options) {
        var i, iz, j, jz, variable, name, def, ref, generator;
        var varMap = {};
        var idMap = {};

        generator = new NameGenerator(scope, options);

        if (scope.isStatic()) {
            // skip TDZ scope for now
            if (scope.type === 'TDZ') {
                return;
            }

            name = '9';

            scope.variables.sort(function (a, b) {
                if (a.tainted) {
                    return 1;
                }
                if (b.tainted) {
                    return -1;
                }
                return (b.identifiers.length + b.references.length) - (a.identifiers.length + a.references.length);
            });

            /**
             * fix through
             */
            scope.through.forEach(function (n) {
              var name = n.identifier.name;
              var upper = scope.upper;
              var map;
              if (n.identifier.__done__) {
                return;
              }
              while (upper) {
                map = upper.__var_map__;
                if (map && map[name]) {
                  n.identifier.name = map[name];
                  n.identifier.__done__ = true;
                  break;
                }
                upper = upper.upper;
              }
            });

            for (i = 0, iz = scope.variables.length; i < iz; ++i) {
                variable = scope.variables[i];

                if (variable.tainted) {
                    continue;
                }

                // Because `arguments` definition is nothing.
                // But if `var arguments` is defined, identifiers.length !== 0
                // and this doesn't indicate arguments.
                if (variable.identifiers.length === 0) {
                    // do not change names because this is special name
                    continue;
                }
                name = generator.generateName(name);

                for (j = 0, jz = variable.identifiers.length; j < jz; ++j) {
                    def = variable.identifiers[j];
                    if (def.__done__) {
                      continue;
                    }
                    varMap[variable.name] = name;
                    idMap[name] = variable.name;
                    // change definition's name
                    def.name = name;
                    def.__done__ = true;
                }

                for (j = 0, jz = variable.references.length; j < jz; ++j) {
                    ref = variable.references[j];
                    if (ref.identifier.__done__) {
                      continue;
                    }
                    // change reference's name
                    ref.identifier.name = name;
                    ref.identifier.__done__ = true;
                }
            }
            scope.__var_map__ = varMap;
            scope.__id_map__ = idMap;
            var scopeFrom;

            for (j = 0, jz = scope.references.length; j < jz; ++j) {
              ref = scope.references[j];
              if (ref.identifier.__done__) {
                continue;
              }
              scopeFrom = ref.from;
              while (scopeFrom) {
                varMap = scopeFrom.__var_map__;
                if (varMap && varMap[ref.identifier.name]) {
                  // change reference's name
                  ref.identifier.name = varMap[ref.identifier.name];
                  break;
                }
                scopeFrom = scopeFrom.upper;
              }
            }
        }
    }

    function Label(node, upper) {
        this.node = node;
        this.upper = upper;
        this.users = [];
        this.names = new Map();
        this.name = null;
    }

    Label.prototype.mangle = function () {
        var tip, current, i, iz;
        tip = '9';

        // merge already used names
        for (current = this.upper; current; current = current.upper) {
            if (current.name !== null) {
                this.names.set(current.name, true);
            }
        }

        do {
            tip = utility.generateNextName(tip);
        } while (this.names.has(tip));

        this.name = tip;

        for (current = this.upper; current; current = current.upper) {
            current.names.set(tip, true);
        }

        this.node.label.name = tip;
        for (i = 0, iz = this.users.length; i < iz; ++i) {
            this.users[i].label.name = tip;
        }
    };

    function LabelScope(upper) {
        this.map = new Map();
        this.upper = upper;
        this.label = null;
        this.labels = [];
    }

    LabelScope.prototype.register = function register(node) {
        var name;

        assert(node.type === Syntax.LabeledStatement, 'node should be LabeledStatement');

        this.label = new Label(node, this.label);
        this.labels.push(this.label);

        name = node.label.name;
        assert(!this.map.has(name), 'duplicate label is found');
        this.map.set(name, this.label);
    };

    LabelScope.prototype.unregister = function unregister(node) {
        var name, ref;
        if (node.type !== Syntax.LabeledStatement) {
            return;
        }

        name = node.label.name;
        ref = this.map.get(name);
        this.map['delete'](name);

        this.label = ref.upper;
    };

    LabelScope.prototype.resolve = function resolve(node) {
        var name;
        if (node.label) {
            name = node.label.name;
            assert(this.map.has(name), 'unresolved label');
            this.map.get(name).users.push(node);
        }
    };

    LabelScope.prototype.close = function close() {
        var i, iz, label;
        this.labels.sort(function (lhs, rhs) {
            return rhs.users.length - lhs.users.length;
        });

        for (i = 0, iz = this.labels.length; i < iz; ++i) {
            label = this.labels[i];
            label.mangle();
        }

        return this.upper;
    };

    function mangleLabels(tree) {
        var labelScope;
        var FuncOrProgram = [Syntax.Program, Syntax.FunctionExpression, Syntax.FunctionDeclaration];
        estraverse.traverse(tree, {
            enter: function (node) {
                if (FuncOrProgram.indexOf(node.type) >= 0) {
                    labelScope = new LabelScope(labelScope);
                    return;
                }

                switch (node.type) {
                case Syntax.LabeledStatement:
                    labelScope.register(node);
                    break;

                case Syntax.BreakStatement:
                case Syntax.ContinueStatement:
                    labelScope.resolve(node);
                    break;
                }
            },
            leave: function (node) {
                labelScope.unregister(node);
                if (FuncOrProgram.indexOf(node.type) >= 0) {
                    labelScope = labelScope.close();
                }
            }
        });

        return tree;
    }

    function mangle(tree, options) {
        var result, manager, i, iz;

        if (options == null) {
            options = { destructive: false };
        }

        result = (options.destructive == null || options.destructive) ? tree : utility.deepCopy(tree);
        manager = escope.analyze(result, {
            directive: true,
            ecmaVersion: options.esmaVersion || 6,
            sourceType: options.sourceType || 'script'
        });
        // mangling names
        for (i = 0, iz = manager.scopes.length; i < iz; ++i) {
            run(manager.scopes[i], options);
        }

        // mangling labels
        return mangleLabels(result);
    }

    exports.mangle = mangle;
    exports.version = version;
    exports.generateNextName = utility.generateNextName;
}());
/* vim: set sw=4 ts=4 et tw=80 : */
