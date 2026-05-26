(function (root) {

  const sampleNotes = [
    {
      id: "nlp",
      title: "Обработка естественного языка",
      text: "NLP приводит текст к удобному виду: очищает разметку, выделяет термины и превращает документы в числовые признаки. Это нужно для поиска похожих фрагментов и ранжирования заметок.",
    },
    {
      id: "cleanup",
      title: "Предобработка заметок",
      text: "Перед сравнением текст очищают от Markdown, ссылок, кода и лишних пробелов. Нормализация снижает шум и помогает алгоритмам сравнивать смысловые части заметок.",
    },
    {
      id: "tfidf",
      title: "TF-IDF",
      text: "TF-IDF усиливает ключевые слова документа и строит разреженный вектор. Косинусная близость сравнивает такие векторы и помогает ранжировать рекомендации.",
    },
    {
      id: "cosine",
      title: "Косинусная близость",
      text: "Косинусная мера сравнивает направление векторов TF-IDF или LSA. Если документы используют похожие признаки, угол между векторами мал, а score становится выше.",
    },
    {
      id: "lsa",
      title: "Латентный семантический анализ",
      text: "LSA сжимает матрицу терминов в несколько скрытых факторов. После такого сжатия документы могут быть близки даже при неполном совпадении словаря.",
    },
    {
      id: "recs",
      title: "Рекомендации заметок",
      text: "Рекомендательная схема выбирает исходную заметку, считает косинусную близость со всеми остальными и сортирует кандидатов по убыванию score.",
    },
    {
      id: "graph",
      title: "Граф связей",
      text: "Граф показывает заметки как узлы, а найденные связи как ребра. Толщина ребра зависит от рассчитанной близости между двумя текстами.",
    },
    {
      id: "metrics",
      title: "Метрики качества",
      text: "Precision@K, Recall@K и NDCG@K сравнивают выдачу алгоритма с заранее размеченными связями. Эти метрики показывают точность, полноту и порядок результатов.",
    },
    {
      id: "osint",
      title: "OSINT",
      text: "OSINT собирает открытые источники: домены, публикации, метаданные и профили. Такие материалы удобно связывать с заметками об инцидентах и сетевой активности.",
    },
    {
      id: "traffic",
      title: "Сетевой трафик",
      text: "Анализ трафика рассматривает DNS, HTTP, TLS и подозрительные соединения. Журналы помогают находить признаки атаки и восстанавливать цепочку событий.",
    },
    {
      id: "auth",
      title: "Аутентификация",
      text: "Аутентификация подтверждает личность пользователя через пароль, токен, ключ или второй фактор. Надежная проверка снижает риск несанкционированного входа.",
    },
    {
      id: "access",
      title: "Управление доступом",
      text: "Управление доступом задает роли, права и ограничения для действий пользователя. Минимальные привилегии уменьшают последствия ошибки или компрометации.",
    },
    {
      id: "passwords",
      title: "Пароли и секреты",
      text: "Пароли хранят в виде стойких хэшей с солью, а секреты выносят из исходного кода. Утечка ключей часто приводит к захвату учетных записей.",
    },
    {
      id: "incident",
      title: "Расследование инцидента",
      text: "Расследование объединяет события из журналов, сетевые следы, учетные записи и открытые источники. Цель — восстановить хронологию и найти причину нарушения.",
    },
    {
      id: "cluster",
      title: "Кластеризация текстов",
      text: "Кластеризация группирует документы без заранее заданных классов. Похожие заметки попадают в одну область векторного пространства.",
    },
    {
      id: "vectors",
      title: "Векторное пространство",
      text: "Векторное представление превращает текст в набор чисел. После этого можно считать расстояния, строить графы и сравнивать документы алгоритмически.",
    },
    {
      id: "neural_nets",
      title: "Neural Networks",
      text: "Neural networks learn representations through layered weighted connections. Backpropagation adjusts weights by minimizing prediction error. Transformers and CNNs are standard architectures for NLP and image recognition tasks.",
    },
    {
      id: "info_retrieval",
      title: "Information Retrieval",
      text: "Information retrieval ranks documents by relevance to a query using term frequency signals. BM25 and TF-IDF score term importance across corpora. Semantic search extends this with dense embeddings that capture meaning beyond keyword overlap.",
    },
  ];

  const relevance = {
    nlp:      ["cleanup", "tfidf", "lsa"],
    cleanup:  ["nlp", "tfidf", "vectors"],
    tfidf:    ["cosine", "vectors", "recs"],
    cosine:   ["tfidf", "vectors", "recs"],
    lsa:      ["nlp", "vectors", "cluster"],
    recs:     ["tfidf", "cosine", "metrics"],
    graph:    ["recs", "cluster", "vectors"],
    metrics:  ["recs", "tfidf", "cosine"],
    osint:    ["traffic", "incident"],
    traffic:  ["osint", "incident"],
    auth:     ["access", "passwords"],
    access:   ["auth", "passwords", "incident"],
    passwords:["auth", "access"],
    incident: ["osint", "traffic", "access"],
    cluster:        ["lsa", "graph", "vectors"],
    vectors:        ["tfidf", "cosine", "lsa"],
    neural_nets:    ["embed", "vectors", "lsa", "cluster"],
    info_retrieval: ["tfidf", "cosine", "recs", "neural_nets"],
  };

  const methods = [
    { id: "tfidf",  title: "TF-IDF" },
    { id: "lsa",    title: "LSA" },
    { id: "hybrid", title: "Гибрид" },
    { id: "embed",  title: "Нейросеть" },
  ];

  const stopwords = new Set(
    ("это или для над под при без все как что если так уже еще где чем они она оно его ее их был была были быть есть нет этот эта эти тоже такой такая такие между после перед через только можно нужно часто хорошо плохо выше ниже " +
     "the a an and or for in on at to of is are was were be been being have has had do does did will would should could may might must shall can this that these those it its they them their there here with from by about as not but also more than when how all which who what where just get use used using each one per")
      .split(" "),
  );

  function uid() {
    return "n" + Math.random().toString(36).slice(2, 10);
  }

  function clean(text) {
    return (text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(text) {
    return (
      clean(text)
        .toLowerCase()
        .replace(/ё/g, "е")
        .match(/[\p{L}\p{N}]+/gu) || []
    ).filter((word) => word.length > 2 && !stopwords.has(word));
  }

  function terms(note) {
    const words = tokens(note.title + " " + note.text);
    const result = words.slice();
    for (let i = 0; i < words.length - 1; i += 1) {
      result.push(words[i] + " " + words[i + 1]);
    }
    return result;
  }

  function normalize(map) {
    const length = Math.hypot(...Object.values(map));
    if (!length) return map;
    for (const key of Object.keys(map)) map[key] /= length;
    return map;
  }

  function tfidf(notes) {
    const docs = notes.map(terms);
    const df = {};
    docs.forEach((doc) => new Set(doc).forEach((term) => (df[term] = (df[term] || 0) + 1)));
    const vocab = Object.keys(df).sort();
    const maps = docs.map((doc) => {
      const counts = {};
      doc.forEach((term) => (counts[term] = (counts[term] || 0) + 1));
      const size = doc.length || 1;
      const map = {};
      for (const [term, count] of Object.entries(counts)) {
        map[term] = (count / size) * (Math.log((notes.length + 1) / ((df[term] || 0) + 1)) + 1);
      }
      return normalize(map);
    });
    return { maps, vocab };
  }

  function dot(a, b) {
    let sum = 0;
    const small = Object.keys(a).length < Object.keys(b).length ? a : b;
    const large = small === a ? b : a;
    for (const key of Object.keys(small)) sum += (large[key] || 0) * small[key];
    return sum;
  }

  function cosineRows(rows) {
    return rows.map((a) =>
      rows.map((b) => {
        const length = Math.hypot(...a) * Math.hypot(...b);
        return length ? a.reduce((sum, value, i) => sum + value * b[i], 0) / length : 0;
      }),
    );
  }

  function tfidfMatrix(notes) {
    const { maps } = tfidf(notes);
    return maps.map((a) => maps.map((b) => dot(a, b)));
  }

  function multiply(matrix, vector) {
    return matrix.map((row) => row.reduce((sum, value, i) => sum + value * vector[i], 0));
  }

  function vectorNorm(vector) {
    return Math.hypot(...vector);
  }

  function lsaMatrix(notes, dimensions = 4) {
    const base = tfidfMatrix(notes);
    const n = base.length;
    let gram = base.map((row) => row.slice());
    const components = [];

    for (let c = 0; c < Math.min(dimensions, n); c += 1) {
      let v = Array.from({ length: n }, (_, i) => 1 + Math.sin((i + 1) * (c + 1)));
      let norm = vectorNorm(v);
      v = v.map((x) => x / norm);

      for (let step = 0; step < 60; step += 1) {
        const next = multiply(gram, v);
        norm = vectorNorm(next);
        if (norm < 1e-9) break;
        v = next.map((x) => x / norm);
      }

      const gv = multiply(gram, v);
      const lambda = v.reduce((sum, value, i) => sum + value * gv[i], 0);
      if (lambda < 1e-7) break;

      components.push({ lambda, v });
      gram = gram.map((row, i) => row.map((value, j) => value - lambda * v[i] * v[j]));
    }

    const coords = Array.from({ length: n }, (_, i) =>
      components.map((component) => Math.sqrt(component.lambda) * component.v[i]),
    );
    return cosineRows(coords);
  }

  function mix(a, b, alpha) {
    return a.map((row, i) => row.map((value, j) => alpha * b[i][j] + (1 - alpha) * value));
  }

  function similarity(notes, method, alpha = 0.6, embedMatrix = null) {
    if (!notes.length) return [];
    if (method === "embed") return embedMatrix || tfidfMatrix(notes);
    const tf = tfidfMatrix(notes);
    if (method === "tfidf") return tf;
    const semantic = lsaMatrix(notes);
    if (method === "lsa") return semantic;
    return mix(tf, semantic, Math.max(0, Math.min(1, alpha)));
  }

  function preview(text, limit = 160) {
    const compact = clean(text);
    return compact.length <= limit ? compact : compact.slice(0, limit - 3).trim() + "...";
  }

  function rank(notes, selectedId, method, topK, alpha = 0.6, embedMatrix = null) {
    const index = notes.findIndex((note) => note.id === selectedId);
    if (index < 0) return [];
    const matrix = similarity(notes, method, alpha, embedMatrix);
    return notes
      .map((note, i) => ({ note, score: i === index ? -Infinity : matrix[index][i] || 0 }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ note, score }) => ({
        id: note.id,
        title: note.title,
        score,
        preview: preview(note.text),
      }));
  }

  function precision(ids, expected) {
    return ids.length ? ids.filter((id) => expected.has(id)).length / ids.length : 0;
  }

  function recall(ids, expected) {
    return expected.size ? ids.filter((id) => expected.has(id)).length / expected.size : 0;
  }

  function ndcg(ids, expected, k) {
    let dcg = 0;
    ids.slice(0, k).forEach((id, i) => {
      if (expected.has(id)) dcg += 1 / Math.log2(i + 2);
    });
    let ideal = 0;
    for (let i = 0; i < Math.min(expected.size, k); i += 1) ideal += 1 / Math.log2(i + 2);
    return ideal ? dcg / ideal : 0;
  }

  function evaluate(notes, method, k, alpha = 0.6, embedMatrix = null) {
    const ids = new Set(notes.map((note) => note.id));
    const rows = Object.entries(relevance)
      .filter(([id]) => ids.has(id))
      .map(([id, expectedIds]) => {
        const expected = new Set(expectedIds.filter((item) => ids.has(item)));
        const result = rank(notes, id, method, k, alpha, embedMatrix).map((item) => item.id);
        return {
          precision: precision(result, expected),
          recall:    recall(result, expected),
          ndcg:      ndcg(result, expected, k),
        };
      })
      .filter((row) => Number.isFinite(row.precision));
    const avg = (key) =>
      rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
    return {
      method:    methods.find((item) => item.id === method)?.title || method,
      queries:   rows.length,
      precision: avg("precision"),
      recall:    avg("recall"),
      ndcg:      avg("ndcg"),
    };
  }

  function graph(notes, method, alpha = 0.6, perNote = 2, embedMatrix = null) {
    const matrix = similarity(notes, method, alpha, embedMatrix);
    const edges = new Map();
    notes.forEach((source, i) => {
      matrix[i]
        .map((score, j) => ({ score, j }))
        .filter((item) => item.j !== i)
        .sort((a, b) => b.score - a.score)
        .slice(0, perNote)
        .forEach(({ score, j }) => {
          const key = [source.id, notes[j].id].sort().join("|");
          edges.set(key, { source: source.id, target: notes[j].id, score });
        });
    });
    return { nodes: notes.map(({ id, title }) => ({ id, title })), edges: [...edges.values()] };
  }

  root.NotesAlgorithms = {
    sampleNotes,
    methods,
    uid,
    clean,
    preview,
    rank,
    evaluate,
    graph,
  };

})(typeof window !== "undefined" ? window : globalThis);
