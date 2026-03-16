"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import withAdminRoute from "@/components/withAdminRoute";

interface Vehicle {
  id: string;
  number: string;
  vehicle_type: string;
  model: string;
  fuel_type: string;
}

function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [form, setForm] = useState({ number: "", vehicle_type: "", model: "", fuel_type: "" });
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchVehicles = async () => {
    const { data } = await supabase.from("vehicles").select("*").order("created_at");
    if (data) setVehicles(data as Vehicle[]);
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  const resetForm = () => {
    setForm({ number: "", vehicle_type: "", model: "", fuel_type: "" });
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.number.trim()) {
      alert("ナンバーは必須です");
      return;
    }

    if (editingId) {
      const { error } = await supabase.from("vehicles").update({
        number: form.number.trim(),
        vehicle_type: form.vehicle_type.trim(),
        model: form.model.trim(),
        fuel_type: form.fuel_type.trim(),
      }).eq("id", editingId);
      if (error) { alert("更新に失敗しました: " + error.message); return; }
    } else {
      const { error } = await supabase.from("vehicles").insert({
        number: form.number.trim(),
        vehicle_type: form.vehicle_type.trim(),
        model: form.model.trim(),
        fuel_type: form.fuel_type.trim(),
      });
      if (error) { alert("登録に失敗しました: " + error.message); return; }
    }

    resetForm();
    fetchVehicles();
  };

  const handleEdit = (v: Vehicle) => {
    setForm({ number: v.number, vehicle_type: v.vehicle_type, model: v.model, fuel_type: v.fuel_type });
    setEditingId(v.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この車両を削除しますか？")) return;
    await supabase.from("vehicles").delete().eq("id", id);
    fetchVehicles();
  };

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-6">車両管理</h1>

      {/* 登録・編集フォーム */}
      <section className="bg-white border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">
          {editingId ? "車両を編集" : "車両を追加"}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">ナンバー *</label>
            <input
              type="text"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              placeholder="例: 品川 300 あ 1234"
              className="border rounded p-2 w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">種類</label>
            <input
              type="text"
              value={form.vehicle_type}
              onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
              placeholder="例: トラック、バン"
              className="border rounded p-2 w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">タイプ</label>
            <input
              type="text"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="例: 2t、4t"
              className="border rounded p-2 w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">燃料種類</label>
            <input
              type="text"
              value={form.fuel_type}
              onChange={(e) => setForm({ ...form, fuel_type: e.target.value })}
              placeholder="例: ガソリン、軽油"
              className="border rounded p-2 w-full"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded"
          >
            {editingId ? "更新" : "追加"}
          </button>
          {editingId && (
            <button
              onClick={resetForm}
              className="bg-gray-300 hover:bg-gray-400 text-gray-700 px-6 py-2 rounded"
            >
              キャンセル
            </button>
          )}
        </div>
      </section>

      {/* 車両一覧 */}
      <section className="bg-white border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">登録車両一覧</h2>
        {vehicles.length === 0 ? (
          <p className="text-gray-400 text-sm">車両が登録されていません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-3">ナンバー</th>
                  <th className="py-2 pr-3">種類</th>
                  <th className="py-2 pr-3">タイプ</th>
                  <th className="py-2 pr-3">燃料</th>
                  <th className="py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="py-2 pr-3 font-medium">{v.number}</td>
                    <td className="py-2 pr-3">{v.vehicle_type}</td>
                    <td className="py-2 pr-3">{v.model}</td>
                    <td className="py-2 pr-3">{v.fuel_type}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(v)}
                          className="text-blue-500 hover:text-blue-700 text-xs"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleDelete(v.id)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default withAdminRoute(VehiclesPage);
