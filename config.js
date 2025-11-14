module.exports = {
  name: "Atticus Deutsch",
  shifts: [
    {
      name: "Morning GH",
      startHour: 7,
      endHour: 11,
      rooms: [
        "GH 1110",
        "GH 1120",
        "GH 1130",
        "GH 1420",
        "GH 1430",
        "GH 1420&30",
        "GH 4101",
        "GH 4301",
        "GH 4302",
        "GH 5101",
        "GH 5201",
        "GH 5301",
      ],
    },
    {
      name: "after 11",
      startHour: 11,
      endHour: 15,
      rooms: [
        "GH 1110",
        "GH 1120",
        "GH 1130",
        "GH 1420",
        "GH 1430",
        "GH 1420&30",
      ],
    },
  ],
  logging: {
    maxRows: 25,
    maxRowsInTest: 10,
  },
};
