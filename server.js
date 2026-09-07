const http = require("http");

const {
  connectDB,
  getDB
} = require("./db");

const {
  sendJSON,
  readBody,
  verifyPassword,
  toObjectId,
  isValidDate,
  validShowTimes
} = require("./utils");

const {
  createSession,
  requireAuth,
  requireRole,
  destroySession
} = require("./auth");

const PORT = 3000;

async function handleRequest(req, res) {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  const path = url.pathname;
  const db = getDB();

  try {

    // LOGIN
    if (req.method === "POST" && path === "/login") {
      const body = await readBody(req);
      const { email, password } = body;

      if (!email || !password) {
        return sendJSON(res, 400, { message: "Email and password required" });
      }

      const user = await db.collection("users").findOne({ email });

      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJSON(res, 401, { message: "Invalid credentials" });
      }

      const token = createSession(user);

      return sendJSON(res, 200, {
        token,
        role: user.role
      });
    }

    // LOGOUT
    if (req.method === "POST" && path === "/logout") {
      const session = requireAuth(req, res);
      if (!session) return;

      destroySession(session.token);

      return sendJSON(res, 200, { message: "Logged out" });
    }

    // VIEW ALL MOVIES
    if (req.method === "GET" && path === "/movies") {
      const session = requireAuth(req, res);
      if (!session) return;

      const movies = await db.collection("movies").find().toArray();

      return sendJSON(res, 200, movies);
    }

    // USER: BOOK SEAT
    if (req.method === "POST" && path === "/bookings") {
      const session = requireRole(req, res, "user");
      if (!session) return;

      const body = await readBody(req);
      const { movieId, date, showTime, seatNo } = body;

      if (!movieId || !date || !showTime || !seatNo) {
        return sendJSON(res, 400, { message: "movieId, date, showTime and seatNo are required" });
      }

      if (!isValidDate(date)) {
        return sendJSON(res, 400, { message: "Invalid date format, expected YYYY-MM-DD" });
      }

      const movieObjectId = toObjectId(movieId);

      if (!movieObjectId) {
        return sendJSON(res, 400, { message: "Invalid movieId" });
      }

      const movie = await db.collection("movies").findOne({ _id: movieObjectId });

      if (!movie) {
        return sendJSON(res, 404, { message: "Movie not found" });
      }

      if (!movie.showTimes.includes(showTime)) {
        return sendJSON(res, 400, { message: "Invalid show time for this movie" });
      }

      try {
        const result = await db.collection("bookings").insertOne({
          userId: session.userId,
          movieId: movieObjectId,
          date,
          showTime,
          seatNo,
          bookedAt: new Date()
        });

        return sendJSON(res, 201, {
          message: "Seat booked successfully",
          bookingId: result.insertedId
        });
      } catch (err) {
        if (err.code === 11000) {
          return sendJSON(res, 409, { message: "Seat already booked" });
        }
        throw err;
      }
    }

    // USER: VIEW OWN BOOKINGS
    if (req.method === "GET" && path === "/bookings") {
      const session = requireRole(req, res, "user");
      if (!session) return;

      const bookings = await db.collection("bookings")
        .find({ userId: session.userId })
        .toArray();

      return sendJSON(res, 200, bookings);
    }

    // THEATER: VIEW OWN MOVIES
    if (req.method === "GET" && path === "/theater/movies") {
      const session = requireRole(req, res, "theater");
      if (!session) return;

      const theaterObjectId = toObjectId(session.userId);

      const movies = await db.collection("movies")
        .find({ theaterId: theaterObjectId })
        .toArray();

      return sendJSON(res, 200, movies);
    }

    // THEATER: ADD MOVIE
    if (req.method === "POST" && path === "/movies") {
      const session = requireRole(req, res, "theater");
      if (!session) return;

      const body = await readBody(req);
      const { title, language, duration, showTimes } = body;

      if (!title || !language || !duration) {
        return sendJSON(res, 400, { message: "title, language and duration are required" });
      }

      if (!validShowTimes(showTimes)) {
        return sendJSON(res, 400, { message: "showTimes must contain exactly 4 unique values" });
      }

      const theaterObjectId = toObjectId(session.userId);

      const result = await db.collection("movies").insertOne({
        theaterId: theaterObjectId,
        title,
        language,
        duration,
        showTimes
      });

      return sendJSON(res, 201, {
        message: "Movie added",
        movieId: result.insertedId
      });
    }

    // THEATER: UPDATE MOVIE
    const updateMovieMatch = path.match(/^\/movies\/([^/]+)$/);

    if (req.method === "PUT" && updateMovieMatch) {
      const session = requireRole(req, res, "theater");
      if (!session) return;

      const movieObjectId = toObjectId(updateMovieMatch[1]);

      if (!movieObjectId) {
        return sendJSON(res, 400, { message: "Invalid movieId" });
      }

      const body = await readBody(req);
      const { title, language, duration, showTimes } = body;

      if (showTimes !== undefined && !validShowTimes(showTimes)) {
        return sendJSON(res, 400, { message: "showTimes must contain exactly 4 unique values" });
      }

      const updateFields = {};
      if (title !== undefined) updateFields.title = title;
      if (language !== undefined) updateFields.language = language;
      if (duration !== undefined) updateFields.duration = duration;
      if (showTimes !== undefined) updateFields.showTimes = showTimes;

      if (Object.keys(updateFields).length === 0) {
        return sendJSON(res, 400, { message: "No valid fields to update" });
      }

      const theaterObjectId = toObjectId(session.userId);

      const result = await db.collection("movies").updateOne(
        { _id: movieObjectId, theaterId: theaterObjectId },
        { $set: updateFields }
      );

      if (result.matchedCount === 0) {
        return sendJSON(res, 404, { message: "Movie not found" });
      }

      return sendJSON(res, 200, { message: "Movie updated" });
    }

    // THEATER: REMOVE MOVIE
    const deleteMovieMatch = path.match(/^\/movies\/([^/]+)$/);

    if (req.method === "DELETE" && deleteMovieMatch) {
      const session = requireRole(req, res, "theater");
      if (!session) return;

      const movieObjectId = toObjectId(deleteMovieMatch[1]);

      if (!movieObjectId) {
        return sendJSON(res, 400, { message: "Invalid movieId" });
      }

      const theaterObjectId = toObjectId(session.userId);

      const result = await db.collection("movies").deleteOne({
        _id: movieObjectId,
        theaterId: theaterObjectId
      });

      if (result.deletedCount === 0) {
        return sendJSON(res, 404, { message: "Movie not found" });
      }

      await db.collection("bookings").deleteMany({ movieId: movieObjectId });

      return sendJSON(res, 200, { message: "Movie deleted" });
    }

    // NO ROUTE MATCHED
    return sendJSON(res, 404, { message: "Route not found" });

  } catch (err) {
    console.error(err);
    return sendJSON(res, 500, { message: "Internal server error" });
  }
}

async function startServer() {
  await connectDB();

  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(
      `Server running on http://localhost:${PORT}`
    );
  });
}

startServer().catch(console.error);
