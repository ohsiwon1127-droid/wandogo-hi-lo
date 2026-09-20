// tests/fakeCollection.js
// 실제 MongoDB 없이 라우트/소켓 로직을 그대로 검증하기 위한 아주 단순한
// 인메모리 컬렉션. Mongoose 모델이 쓰는 메서드 중 이 프로젝트가 실제로
// 사용하는 것만 최소로 구현한다 (진짜 DB가 아님, 테스트 전용).

let idCounter = 1;
function nextId() {
  return "id_" + idCounter++;
}

function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter || {})) {
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$gte" in cond && !(doc[key] >= cond.$gte)) return false;
      if ("$in" in cond && !cond.$in.includes(doc[key])) return false;
    } else {
      if (String(doc[key]) !== String(cond)) return false;
    }
  }
  return true;
}

function applyUpdate(doc, update) {
  const hasOperator = Object.keys(update).some((k) => k.startsWith("$"));
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
  }
  if (update.$set) Object.assign(doc, update.$set);
  if (!hasOperator) Object.assign(doc, update);
}

class FakeCollection {
  constructor() {
    this.docs = new Map();
  }

  _wrap(doc) {
    doc.save = async () => {
      this.docs.set(String(doc._id), { ...doc });
    };
    return doc;
  }

  async create(fields) {
    const doc = { _id: nextId(), ...fields };
    this.docs.set(doc._id, doc);
    return this._wrap({ ...doc });
  }

  async findOne(filter) {
    for (const doc of this.docs.values()) {
      if (matches(doc, filter)) return this._wrap({ ...doc });
    }
    return null;
  }

  async findById(id) {
    const doc = this.docs.get(String(id));
    return doc ? this._wrap({ ...doc }) : null;
  }

  async findByIdAndUpdate(id, update) {
    const doc = this.docs.get(String(id));
    if (!doc) return null;
    applyUpdate(doc, update);
    this.docs.set(doc._id, doc);
    return this._wrap({ ...doc });
  }

  async findOneAndUpdate(filter, update) {
    for (const doc of this.docs.values()) {
      if (matches(doc, filter)) {
        applyUpdate(doc, update);
        this.docs.set(doc._id, doc);
        return this._wrap({ ...doc });
      }
    }
    return null;
  }

  async deleteOne(filter) {
    for (const [id, doc] of this.docs.entries()) {
      if (matches(doc, filter)) {
        this.docs.delete(id);
        return { deletedCount: 1 };
      }
    }
    return { deletedCount: 0 };
  }

  find(filter = {}, projection = null) {
    let results = [...this.docs.values()]
      .filter((d) => matches(d, filter))
      .map((d) => {
        const copy = { ...d };
        delete copy.save;
        if (projection === "-passwordHash") delete copy.passwordHash;
        return copy;
      });

    const chain = {
      sort(spec) {
        const entries = Object.entries(spec);
        results.sort((a, b) => {
          for (const [k, dir] of entries) {
            if (a[k] < b[k]) return -1 * dir;
            if (a[k] > b[k]) return 1 * dir;
          }
          return 0;
        });
        return chain;
      },
      limit(n) {
        results = results.slice(0, n);
        return chain;
      },
      then(resolve, reject) {
        return Promise.resolve(results).then(resolve, reject);
      },
    };
    return chain;
  }

  async countDocuments(filter = {}) {
    return [...this.docs.values()].filter((d) => matches(d, filter)).length;
  }

  async aggregate(pipeline) {
    const groupStage = pipeline.find((s) => s.$group);
    if (!groupStage) return [...this.docs.values()];
    const field = Object.values(groupStage.$group).find((v) => v && v.$sum)?.$sum;
    const key = String(field).replace("$", "");
    const sum = [...this.docs.values()].reduce((acc, d) => acc + (d[key] || 0), 0);
    return [{ _id: null, sum }];
  }
}

module.exports = { FakeCollection };
