const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT;

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
};

async function getConn() {
  return mysql.createConnection(dbConfig);
}

app.get("/productos", async (req, res) => {
  try {
    const conn = await getConn();
    const [rows] = await conn.query("select id, nombre, precio_unitario from productos order by id asc");
    await conn.end();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener productos", details: String(err) });
  }
});

app.get("/ordenes", async (req, res) => {
  try {
    const conn = await getConn();
    const [rows] = await conn.query("select * from ordenes order by id desc");
    await conn.end();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener ordenes", details: String(err) });
  }
});

app.get("/ordenes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conn = await getConn();

    const [orden] = await conn.query("select * from ordenes where id = ?", [id]);
    if (orden.length === 0) {
      await conn.end();
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const [detalles] = await conn.query(
      "select * from detalle_orden where orden_id = ? order by id asc",
      [id]
    );

    await conn.end();
    res.json({ orden: orden[0], detalles });
  } catch (err) {
    res.status(500).json({ error: "Error al obtener orden", details: String(err) });
  }
});

app.post("/ordenes", async (req, res) => {
  try {
    const { numero_orden, fecha, detalles } = req.body;

    if (!numero_orden) return res.status(400).json({ error: "numero_orden es requerido" });
    if (!fecha) return res.status(400).json({ error: "fecha es requerida" });
    if (!Array.isArray(detalles) || detalles.length === 0)
      return res.status(400).json({ error: "detalles es requerido (min 1 producto)" });

    const cantidad_productos = detalles.length;
    const precio_final = detalles.reduce((sum, d) => sum + Number(d.precio_total || 0), 0);

    const conn = await getConn();

    const [result] = await conn.query(
      "insert into ordenes (numero_orden, fecha, cantidad_productos, precio_final) values (?,?,?,?)",
      [numero_orden, fecha, cantidad_productos, precio_final]
    );

    const ordenId = result.insertId;

    for (const d of detalles) {
      await conn.query(
        "insert into detalle_orden (orden_id, producto_id, cantidad, precio_unitario, precio_total) values (?,?,?,?,?)",
        [ordenId, d.producto_id, d.cantidad, d.precio_unitario, d.precio_total]
      );
    }

    await conn.end();
    res.json({ id: ordenId });
  } catch (err) {
    res.status(500).json({ error: "Error al crear orden", details: String(err) });
  }
});

app.put("/ordenes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { numero_orden, fecha, detalles } = req.body;

    if (!numero_orden) return res.status(400).json({ error: "numero_orden es requerido" });
    if (!fecha) return res.status(400).json({ error: "fecha es requerida" });
    if (!Array.isArray(detalles) || detalles.length === 0)
      return res.status(400).json({ error: "detalles es requerido (min 1 producto)" });

    const cantidad_productos = detalles.length;
    const precio_final = detalles.reduce((sum, d) => sum + Number(d.precio_total || 0), 0);

    const conn = await getConn();

    const [exists] = await conn.query("SELECT id, estado FROM ordenes WHERE id=?", [id]);
    if (exists.length === 0) {
      await conn.end();
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (exists[0].estado === "Completado") {
      await conn.end();
      return res.status(403).json({ error: "No se puede modificar una orden Completado" });
    }


    await conn.query(
      "update ordenes set numero_orden=?, fecha=?, cantidad_productos=?, precio_final=? where id=?",
      [numero_orden, fecha, cantidad_productos, precio_final, id]
    );

    await conn.query("delete from detalle_orden where orden_id=?", [id]);

    for (const d of detalles) {
      await conn.query(
        "insert into detalle_orden (orden_id, producto_id, cantidad, precio_unitario, precio_total) values (?,?,?,?,?)",
        [id, d.producto_id, d.cantidad, d.precio_unitario, d.precio_total]
      );
    }

    await conn.end();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar orden", details: String(err) });
  }
});

app.delete("/ordenes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conn = await getConn();
    const [row] = await conn.query("SELECT estado FROM ordenes WHERE id=?", [id]);
    if (row.length === 0) {
      await conn.end();
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (row[0].estado === "Completado") {
      await conn.end();
      return res.status(403).json({ error: "No se puede eliminar una orden Completado" });
    }
    await conn.query("delete from ordenes where id=?", [id]);
    await conn.end();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar orden", details: String(err) });
  }
});

app.patch("/ordenes/:id/estado", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { estado } = req.body;

    const permitidos = ["Pendiente", "En Progreso", "Completado"];
    if (!permitidos.includes(estado)) {
      return res.status(400).json({ error: "Estado inválido", estado_recibido: estado });
    }

    const conn = await getConn();

    const [exists] = await conn.query("SELECT id FROM ordenes WHERE id=?", [id]);
    if (exists.length === 0) {
      await conn.end();
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    await conn.query("UPDATE ordenes SET estado=? WHERE id=?", [estado, id]);
    await conn.end();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al cambiar estado", details: String(err) });
  }
});



app.listen(PORT, () => {
  console.log("API corriendo en puerto", PORT);
});



